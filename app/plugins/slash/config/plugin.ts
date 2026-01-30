/**
 * /config command plugin
 *
 * Allows users to manage their personal bot settings:
 * - API Key (OpenRouter)
 * - Default chat model
 * - Image generation models
 * - Webhooks for image routing
 */

import { validateModel } from '@app/helpers/openrouter';
import { detectWebhookType, testWebhook } from '@app/helpers/webhook';
import type {
  AutocompleteRequest,
  BotButton,
  BotEmbed,
  BotSelectMenu,
  ButtonInteraction,
  CommandHandlerPlugin,
  CommandInvocation,
  ModalSubmitInteraction,
  PluginContext,
  SelectMenuInteraction,
} from '@core';
import { getBotConfig, registerCommand, unregisterCommand } from '@core';
import {
  addUserWebhook,
  clearAllUserSettings,
  deleteUserApiKey,
  getAllUserSettings,
  getUserByPlatformId,
  getUserMemoryScope,
  getUserWebhooks,
  type MemoryScope,
  removeUserWebhook,
  setUserApiKey,
  setUserDefaultModel,
  setUserImageModels,
  setUserMemoryScope,
  type WebhookConfig,
} from '@core/database';
import { configCommand } from './command';

export class ConfigCommandPlugin implements CommandHandlerPlugin {
  readonly id = 'config';
  readonly type = 'command' as const;
  readonly commands = ['config'];

  private context?: PluginContext;

  async load(context: PluginContext): Promise<void> {
    this.context = context;

    registerCommand(configCommand, this.id);

    context.eventBus.on('command:received', this.handleCommand.bind(this));
    context.eventBus.on('command:autocomplete', this.handleAutocomplete.bind(this));
    context.eventBus.on('interaction:modal', this.handleModal.bind(this));
    context.eventBus.on('interaction:button', this.handleButton.bind(this));
    context.eventBus.on('interaction:select', this.handleSelect.bind(this));

    context.logger.info('ConfigCommandPlugin loaded');
  }

  async unload(): Promise<void> {
    unregisterCommand('config');
    this.context?.logger.info('ConfigCommandPlugin unloaded');
    this.context = undefined;
  }

  // ===========================================================================
  // Command Handler
  // ===========================================================================

  private async handleCommand(invocation: CommandInvocation): Promise<void> {
    if (invocation.commandName !== 'config') return;

    const { platform, user, subcommand, subcommandGroup } = invocation;

    // Get user's internal ID
    const dbUser = getUserByPlatformId(platform, user.id);
    if (!dbUser) {
      await invocation.reply({
        content: '❌ You need to send at least one message before using this command.',
        ephemeral: true,
      });
      return;
    }

    // Handle webhook subcommand group
    if (subcommandGroup === 'webhook') {
      switch (subcommand) {
        case 'add':
          await this.handleWebhookAdd(invocation);
          break;
        case 'list':
          await this.handleWebhookList(invocation, dbUser.id);
          break;
        case 'remove':
          await this.handleWebhookRemove(invocation, dbUser.id);
          break;
        case 'test':
          await this.handleWebhookTest(invocation, dbUser.id);
          break;
        default:
          await invocation.reply({
            content: '❌ Unknown webhook subcommand',
            ephemeral: true,
          });
      }
      return;
    }

    // Handle top-level subcommands
    switch (subcommand) {
      case 'view':
        await this.handleView(invocation, dbUser.id);
        break;
      case 'apikey':
        await this.handleApiKey(invocation);
        break;
      case 'clearapikey':
        await this.handleApiKeyClear(invocation, dbUser.id);
        break;
      case 'chatmodel':
        await this.handleChatModel(invocation);
        break;
      case 'imagemodels':
        await this.handleImageModels(invocation);
        break;
      case 'scope':
        await this.handleScope(invocation, dbUser.id);
        break;
      case 'reset':
        await this.handleReset(invocation, dbUser.id);
        break;
      default:
        await invocation.reply({
          content: '❌ Unknown subcommand',
          ephemeral: true,
        });
    }
  }

  // ===========================================================================
  // Subcommand Handlers
  // ===========================================================================

  /**
   * /config view - Show current settings
   */
  private async handleView(invocation: CommandInvocation, userId: number): Promise<void> {
    const settings = getAllUserSettings(userId);
    const webhooks = (settings.image_webhooks as WebhookConfig[]) ?? [];
    const memoryScope = getUserMemoryScope(userId);

    const embed: BotEmbed = {
      title: '⚙️ Your Bot Settings',
      color: 0x5865f2, // Discord blurple
      fields: [
        {
          name: '🔑 API Key',
          value: settings.openrouter_api_key ? '✓ Set' : 'Not configured',
          inline: true,
        },
        {
          name: '💬 Chat Model',
          value: (settings.default_chat_model as string) || 'Not configured',
          inline: true,
        },
        {
          name: '📦 Memory Scope',
          value: memoryScope === 'global' ? '🌐 Global (shared everywhere)' : '🏠 Per-server (default)',
          inline: true,
        },
        {
          name: '🎨 Image Models',
          value: (settings.image_models as string[])?.join(', ') || 'Not configured',
          inline: false,
        },
        {
          name: '🔗 Webhooks',
          value:
            webhooks.length > 0
              ? `${webhooks.length} configured: ${webhooks.map((w) => w.name).join(', ')}`
              : 'None configured',
          inline: false,
        },
      ],
      footer: {
        text: 'Use /config <setting> to change these',
      },
    };

    await invocation.reply({
      embeds: [embed],
      ephemeral: true,
    });
  }

  /**
   * /config api-key - Show modal to set API key
   */
  private async handleApiKey(invocation: CommandInvocation): Promise<void> {
    await invocation.showModal({
      customId: 'config_api_key_modal',
      title: 'Set OpenRouter API Key',
      fields: [
        {
          customId: 'api_key',
          label: 'OpenRouter API Key',
          style: 'short',
          placeholder: 'sk-or-v1-...',
          required: true,
          minLength: 10,
          maxLength: 200,
        },
      ],
    });
  }

  /**
   * /config api-key-clear - Show confirmation button
   */
  private async handleApiKeyClear(invocation: CommandInvocation, userId: number): Promise<void> {
    const settings = getAllUserSettings(userId);

    if (!settings.openrouter_api_key) {
      await invocation.reply({
        content: "📭 You don't have an API key stored.",
        ephemeral: true,
      });
      return;
    }

    const button: BotButton = {
      type: 'button',
      customId: 'config_api_key_clear_confirm',
      label: 'Remove API Key',
      style: 'danger',
    };

    await invocation.reply({
      content: '⚠️ **Are you sure you want to remove your API key?**\n\nThis will stop any personal model usage.',
      components: [[button]],
      ephemeral: true,
    });
  }

  /**
   * /config chat-model - Show modal to set default chat model
   */
  private async handleChatModel(invocation: CommandInvocation): Promise<void> {
    await invocation.showModal({
      customId: 'config_chat_model_modal',
      title: 'Set Default Chat Model',
      fields: [
        {
          customId: 'model',
          label: 'Default Chat Model',
          style: 'short',
          placeholder: 'anthropic/claude-sonnet-4-20250514',
          required: true,
          minLength: 3,
          maxLength: 100,
        },
      ],
    });
  }

  /**
   * /config image-models - Show modal to set image models
   */
  private async handleImageModels(invocation: CommandInvocation): Promise<void> {
    await invocation.showModal({
      customId: 'config_image_models_modal',
      title: 'Set Image Generation Models',
      fields: [
        {
          customId: 'models',
          label: 'Image Models (one per line)',
          style: 'paragraph',
          placeholder: 'openai/dall-e-3\nblack-forest-labs/flux-1.1-pro',
          required: true,
          minLength: 3,
          maxLength: 1000,
        },
      ],
    });
  }

  /**
   * /config scope - Set memory/profile scope (per-server or global)
   */
  private async handleScope(invocation: CommandInvocation, userId: number): Promise<void> {
    const mode = invocation.args.mode as MemoryScope;
    const currentScope = getUserMemoryScope(userId);

    if (mode === currentScope) {
      const modeLabel = mode === 'global' ? '🌐 Global' : '🏠 Per-server';
      await invocation.reply({
        content: `📦 Your memory scope is already set to **${modeLabel}**.`,
        ephemeral: true,
      });
      return;
    }

    setUserMemoryScope(userId, mode);

    const newModeLabel = mode === 'global' ? '🌐 Global' : '🏠 Per-server';
    const description =
      mode === 'global'
        ? 'New memories and profile data will be shared across all servers and DMs.'
        : 'New memories and profile data will be stored separately for each server.';

    await invocation.reply({
      content: `✅ Memory scope changed to **${newModeLabel}**!\n\n${description}\n\n💡 **Tip:** Use \`/migrate\` in a server to move existing data to global or another server.`,
      ephemeral: true,
    });

    this.context?.logger.info('[Config] Memory scope changed', { userId, scope: mode });
  }

  /**
   * /config reset - Show confirmation button
   */
  private async handleReset(invocation: CommandInvocation, userId: number): Promise<void> {
    const settings = getAllUserSettings(userId);

    if (Object.keys(settings).length === 0) {
      await invocation.reply({
        content: "📭 You don't have any settings to reset.",
        ephemeral: true,
      });
      return;
    }

    const button: BotButton = {
      type: 'button',
      customId: 'config_reset_confirm',
      label: 'Reset All Settings',
      style: 'danger',
    };

    await invocation.reply({
      content:
        '⚠️ **Are you sure you want to reset ALL your settings?**\n\nThis will remove:\n• API Key\n• Chat Model\n• Image Models\n• All Webhooks',
      components: [[button]],
      ephemeral: true,
    });
  }

  // ===========================================================================
  // Webhook Subcommand Handlers
  // ===========================================================================

  /**
   * /config webhook add - Show modal to add webhook
   */
  private async handleWebhookAdd(invocation: CommandInvocation): Promise<void> {
    await invocation.showModal({
      customId: 'config_webhook_add_modal',
      title: 'Add Webhook',
      fields: [
        {
          customId: 'name',
          label: 'Webhook Name',
          style: 'short',
          placeholder: 'NSFW Channel',
          required: true,
          minLength: 1,
          maxLength: 50,
        },
        {
          customId: 'url',
          label: 'Webhook URL',
          style: 'short',
          placeholder: 'https://example.com/webhook or Discord webhook URL',
          required: true,
          minLength: 10,
          maxLength: 500,
        },
        {
          customId: 'categories',
          label: 'Categories (comma-separated)',
          style: 'short',
          placeholder: 'nsfw, lewd, explicit',
          required: false,
          maxLength: 200,
        },
        {
          customId: 'is_default',
          label: 'Default webhook? (yes/no)',
          style: 'short',
          placeholder: 'no',
          required: false,
          maxLength: 10,
        },
      ],
    });
  }

  /**
   * /config webhook list - List all webhooks
   */
  private async handleWebhookList(invocation: CommandInvocation, userId: number): Promise<void> {
    const webhooks = getUserWebhooks(userId);

    if (webhooks.length === 0) {
      await invocation.reply({
        content: '📭 No webhooks configured.\n\nUse `/config webhook add` to add one.',
        ephemeral: true,
      });
      return;
    }

    const embed: BotEmbed = {
      title: '🔗 Your Webhooks',
      color: 0x5865f2,
      fields: webhooks.map((webhook) => ({
        name: `${webhook.isDefault ? '⭐ ' : ''}${webhook.name}`,
        value: [
          `**Type:** ${webhook.type === 'discord' ? 'Discord' : 'Generic HTTP'}`,
          `**ID:** \`${webhook.id.substring(0, 8)}...\``,
          `**Categories:** ${webhook.categories.length > 0 ? webhook.categories.join(', ') : '_none_'}`,
          webhook.isDefault ? '**Default:** Yes' : '',
        ]
          .filter(Boolean)
          .join('\n'),
        inline: false,
      })),
      footer: {
        text: `${webhooks.length} webhook(s) configured`,
      },
    };

    await invocation.reply({
      embeds: [embed],
      ephemeral: true,
    });
  }

  /**
   * /config webhook remove - Show select menu or remove by name
   */
  private async handleWebhookRemove(invocation: CommandInvocation, userId: number): Promise<void> {
    const nameArg = invocation.args.name as string | undefined;
    const webhooks = getUserWebhooks(userId);

    if (webhooks.length === 0) {
      await invocation.reply({
        content: '📭 No webhooks to remove.',
        ephemeral: true,
      });
      return;
    }

    // If name was provided via argument, remove directly
    if (nameArg) {
      const webhook = webhooks.find((w) => w.name.toLowerCase() === nameArg.toLowerCase());

      if (!webhook) {
        await invocation.reply({
          content: `❌ Webhook "${nameArg}" not found.`,
          ephemeral: true,
        });
        return;
      }

      removeUserWebhook(userId, webhook.id);

      await invocation.reply({
        content: `✅ Webhook "${webhook.name}" removed.`,
        ephemeral: true,
      });

      this.context?.logger.info('[Config] Webhook removed', {
        userId,
        webhookName: webhook.name,
      });
      return;
    }

    // Otherwise show select menu
    const select: BotSelectMenu = {
      type: 'select',
      customId: 'config_webhook_remove_select',
      placeholder: 'Select a webhook to remove',
      options: webhooks.map((webhook) => ({
        label: webhook.name,
        value: webhook.id,
        description: webhook.categories.length > 0 ? webhook.categories.slice(0, 3).join(', ') : 'No categories',
      })),
    };

    await invocation.reply({
      content: '🗑️ **Select a webhook to remove:**',
      components: [[select]],
      ephemeral: true,
    });
  }

  /**
   * /config webhook test - Show select menu or test by name
   */
  private async handleWebhookTest(invocation: CommandInvocation, userId: number): Promise<void> {
    const nameArg = invocation.args.name as string | undefined;
    const webhooks = getUserWebhooks(userId);

    if (webhooks.length === 0) {
      await invocation.reply({
        content: '📭 No webhooks to test.',
        ephemeral: true,
      });
      return;
    }

    // If name was provided via argument, test directly
    if (nameArg) {
      const webhook = webhooks.find((w) => w.name.toLowerCase() === nameArg.toLowerCase());

      if (!webhook) {
        await invocation.reply({
          content: `❌ Webhook "${nameArg}" not found.`,
          ephemeral: true,
        });
        return;
      }

      await this.executeWebhookTest(invocation, webhook);
      return;
    }

    // Otherwise show select menu
    const select: BotSelectMenu = {
      type: 'select',
      customId: 'config_webhook_test_select',
      placeholder: 'Select a webhook to test',
      options: webhooks.map((webhook) => ({
        label: webhook.name,
        value: webhook.id,
        description: webhook.categories.length > 0 ? webhook.categories.slice(0, 3).join(', ') : 'No categories',
      })),
    };

    await invocation.reply({
      content: '🧪 **Select a webhook to test:**',
      components: [[select]],
      ephemeral: true,
    });
  }

  /**
   * Execute webhook test
   */
  private async executeWebhookTest(
    interaction: CommandInvocation | SelectMenuInteraction,
    webhook: WebhookConfig,
  ): Promise<void> {
    const config = getBotConfig();
    const botName = config?.bot?.name ?? 'Bot';

    // Defer if it's a command invocation (selects handle differently)
    if ('defer' in interaction && typeof interaction.defer === 'function') {
      await interaction.defer(true);
    }

    const result = await testWebhook(webhook.url, botName);

    const response = result.success
      ? `✅ Webhook "${webhook.name}" test successful!\n\nA test image was sent to the webhook channel.`
      : `❌ Webhook "${webhook.name}" test failed:\n\n\`${result.error}\``;

    // Use followUp for deferred interactions, reply for selects
    if ('followUp' in interaction && typeof interaction.followUp === 'function') {
      await interaction.followUp({
        content: response,
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content: response,
        ephemeral: true,
      });
    }
  }

  // ===========================================================================
  // Autocomplete Handler
  // ===========================================================================

  private async handleAutocomplete(request: AutocompleteRequest): Promise<void> {
    if (request.commandName !== 'config') return;

    // Only handle webhook remove/test name autocomplete
    if (request.subcommandGroup !== 'webhook') return;
    if (request.focusedOption.name !== 'name') return;
    if (!['remove', 'test'].includes(request.subcommand ?? '')) return;

    const dbUser = getUserByPlatformId(request.platform, request.user.id);
    if (!dbUser) {
      await request.respond([]);
      return;
    }

    const webhooks = getUserWebhooks(dbUser.id);
    const search = (request.focusedOption.value ?? '').toLowerCase();

    const matches = webhooks
      .filter((w) => w.name.toLowerCase().includes(search))
      .slice(0, 25)
      .map((w) => ({
        name: w.name,
        value: w.name,
      }));

    await request.respond(matches);
  }

  // ===========================================================================
  // Modal Handler
  // ===========================================================================

  private async handleModal(interaction: ModalSubmitInteraction): Promise<void> {
    if (!interaction.customId.startsWith('config_')) return;

    const dbUser = getUserByPlatformId('discord', interaction.user.id);
    if (!dbUser) {
      await interaction.reply({
        content: '❌ Could not find your user record. Please send a message first.',
        ephemeral: true,
      });
      return;
    }

    switch (interaction.customId) {
      case 'config_api_key_modal':
        await this.handleApiKeyModal(interaction, dbUser.id);
        break;
      case 'config_chat_model_modal':
        await this.handleChatModelModal(interaction, dbUser.id);
        break;
      case 'config_image_models_modal':
        await this.handleImageModelsModal(interaction, dbUser.id);
        break;
      case 'config_webhook_add_modal':
        await this.handleWebhookAddModal(interaction, dbUser.id);
        break;
      default:
        await interaction.reply({
          content: '❌ Unknown modal',
          ephemeral: true,
        });
    }
  }

  /**
   * Handle API key modal submission
   */
  private async handleApiKeyModal(interaction: ModalSubmitInteraction, userId: number): Promise<void> {
    const apiKey = interaction.fields.api_key?.trim() ?? '';

    // Validate key format
    if (!apiKey.startsWith('sk-or-')) {
      await interaction.reply({
        content: '❌ Invalid API key format. OpenRouter keys start with `sk-or-`.',
        ephemeral: true,
      });
      return;
    }

    setUserApiKey(userId, apiKey);

    await interaction.reply({
      content: '✅ API key saved successfully!\n\nYour personal OpenRouter key will now be used for AI requests.',
      ephemeral: true,
    });

    this.context?.logger.info('[Config] API key set', { userId });
  }

  /**
   * Handle chat model modal submission
   */
  private async handleChatModelModal(interaction: ModalSubmitInteraction, userId: number): Promise<void> {
    const model = interaction.fields.model?.trim() ?? '';

    if (!model) {
      await interaction.reply({
        content: '❌ Model ID is required.',
        ephemeral: true,
      });
      return;
    }

    // Defer while validating
    await interaction.defer(true);

    const isValid = await validateModel(model);

    if (!isValid) {
      await interaction.followUp({
        content: `❌ Model \`${model}\` not found on OpenRouter.\n\nCheck the model ID at https://openrouter.ai/models`,
        ephemeral: true,
      });
      return;
    }

    setUserDefaultModel(userId, model);

    await interaction.followUp({
      content: `✅ Chat model set to \`${model}\``,
      ephemeral: true,
    });

    this.context?.logger.info('[Config] Chat model set', { userId, model });
  }

  /**
   * Handle image models modal submission
   */
  private async handleImageModelsModal(interaction: ModalSubmitInteraction, userId: number): Promise<void> {
    const modelsInput = interaction.fields.models?.trim() ?? '';

    if (!modelsInput) {
      await interaction.reply({
        content: '❌ At least one model is required.',
        ephemeral: true,
      });
      return;
    }

    // Parse models (one per line)
    const models = modelsInput
      .split('\n')
      .map((m) => m.trim())
      .filter((m) => m.length > 0);

    if (models.length === 0) {
      await interaction.reply({
        content: '❌ At least one model is required.',
        ephemeral: true,
      });
      return;
    }

    // Defer while validating
    await interaction.defer(true);

    // Validate each model
    const validationResults = await Promise.all(
      models.map(async (model) => ({
        model,
        valid: await validateModel(model),
      })),
    );

    const validModels = validationResults.filter((r) => r.valid).map((r) => r.model);
    const invalidModels = validationResults.filter((r) => !r.valid).map((r) => r.model);

    if (validModels.length === 0) {
      await interaction.followUp({
        content: `❌ None of the models were found on OpenRouter:\n${invalidModels.map((m) => `• \`${m}\``).join('\n')}\n\nCheck model IDs at https://openrouter.ai/models`,
        ephemeral: true,
      });
      return;
    }

    setUserImageModels(userId, validModels);

    let response = `✅ Image models set!\n\n**Valid models (${validModels.length}):**\n${validModels.map((m) => `• \`${m}\``).join('\n')}`;

    if (invalidModels.length > 0) {
      response += `\n\n⚠️ **Invalid models (skipped):**\n${invalidModels.map((m) => `• \`${m}\``).join('\n')}`;
    }

    await interaction.followUp({
      content: response,
      ephemeral: true,
    });

    this.context?.logger.info('[Config] Image models set', {
      userId,
      validCount: validModels.length,
      invalidCount: invalidModels.length,
    });
  }

  /**
   * Handle webhook add modal submission
   */
  private async handleWebhookAddModal(interaction: ModalSubmitInteraction, userId: number): Promise<void> {
    const name = interaction.fields.name?.trim() ?? '';
    const url = interaction.fields.url?.trim() ?? '';
    const categoriesInput = interaction.fields.categories?.trim() ?? '';
    const isDefaultInput = interaction.fields.is_default?.trim().toLowerCase() ?? 'no';

    if (!name || !url) {
      await interaction.reply({
        content: '❌ Name and URL are required.',
        ephemeral: true,
      });
      return;
    }

    // Validate URL format (any valid HTTP/HTTPS URL)
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        throw new Error('Invalid protocol');
      }
    } catch {
      await interaction.reply({
        content: '❌ Invalid webhook URL.\n\nMust be a valid HTTP or HTTPS URL.',
        ephemeral: true,
      });
      return;
    }

    // Parse categories
    const categories = categoriesInput
      ? categoriesInput
          .split(',')
          .map((c) => c.trim().toLowerCase())
          .filter((c) => c.length > 0)
      : [];

    // Parse isDefault
    const isDefault = ['yes', 'true', '1', 'y'].includes(isDefaultInput);

    // Defer while testing
    await interaction.defer(true);

    // Test the webhook
    const config = getBotConfig();
    const botName = config?.bot?.name ?? 'Bot';
    const testResult = await testWebhook(url, botName);

    if (!testResult.success) {
      await interaction.followUp({
        content: `❌ Webhook test failed:\n\n\`${testResult.error}\`\n\nPlease verify the webhook URL and try again.`,
        ephemeral: true,
      });
      return;
    }

    // Auto-detect webhook type from URL
    const webhookType = detectWebhookType(url);

    // Create webhook config
    const webhook: WebhookConfig = {
      id: crypto.randomUUID(),
      name,
      url,
      type: webhookType,
      categories,
      isDefault,
    };

    addUserWebhook(userId, webhook);

    let response = `✅ Webhook "${name}" added and tested successfully!`;

    if (categories.length > 0) {
      response += `\n\n**Categories:** ${categories.join(', ')}`;
    }

    if (isDefault) {
      response += '\n\n⭐ Set as default webhook';
    }

    await interaction.followUp({
      content: response,
      ephemeral: true,
    });

    this.context?.logger.info('[Config] Webhook added', {
      userId,
      webhookName: name,
      categories,
      isDefault,
    });
  }

  // ===========================================================================
  // Button Handler
  // ===========================================================================

  private async handleButton(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.customId.startsWith('config_')) return;

    const dbUser = getUserByPlatformId('discord', interaction.user.id);
    if (!dbUser) {
      await interaction.reply({
        content: '❌ Could not find your user record.',
        ephemeral: true,
      });
      return;
    }

    switch (interaction.customId) {
      case 'config_api_key_clear_confirm':
        await this.handleApiKeyClearConfirm(interaction, dbUser.id);
        break;
      case 'config_reset_confirm':
        await this.handleResetConfirm(interaction, dbUser.id);
        break;
      default:
        await interaction.reply({
          content: '❌ Unknown button action',
          ephemeral: true,
        });
    }
  }

  /**
   * Handle API key clear confirmation button
   */
  private async handleApiKeyClearConfirm(interaction: ButtonInteraction, userId: number): Promise<void> {
    deleteUserApiKey(userId);

    await interaction.update({
      content: '✅ API key removed successfully.',
      components: [],
    });

    this.context?.logger.info('[Config] API key removed', { userId });
  }

  /**
   * Handle reset confirmation button
   */
  private async handleResetConfirm(interaction: ButtonInteraction, userId: number): Promise<void> {
    clearAllUserSettings(userId);

    await interaction.update({
      content: "✅ All settings cleared successfully.\n\nYou're starting fresh!",
      components: [],
    });

    this.context?.logger.info('[Config] All settings cleared', { userId });
  }

  // ===========================================================================
  // Select Menu Handler
  // ===========================================================================

  private async handleSelect(interaction: SelectMenuInteraction): Promise<void> {
    if (!interaction.customId.startsWith('config_')) return;

    const dbUser = getUserByPlatformId('discord', interaction.user.id);
    if (!dbUser) {
      await interaction.reply({
        content: '❌ Could not find your user record.',
        ephemeral: true,
      });
      return;
    }

    switch (interaction.customId) {
      case 'config_webhook_remove_select':
        await this.handleWebhookRemoveSelect(interaction, dbUser.id);
        break;
      case 'config_webhook_test_select':
        await this.handleWebhookTestSelect(interaction, dbUser.id);
        break;
      default:
        await interaction.reply({
          content: '❌ Unknown select action',
          ephemeral: true,
        });
    }
  }

  /**
   * Handle webhook remove select menu
   */
  private async handleWebhookRemoveSelect(interaction: SelectMenuInteraction, userId: number): Promise<void> {
    const webhookId = interaction.values[0];

    if (!webhookId) {
      await interaction.reply({
        content: '❌ No webhook selected.',
        ephemeral: true,
      });
      return;
    }

    const webhooks = getUserWebhooks(userId);
    const webhook = webhooks.find((w) => w.id === webhookId);

    if (!webhook) {
      await interaction.reply({
        content: '❌ Webhook not found.',
        ephemeral: true,
      });
      return;
    }

    removeUserWebhook(userId, webhookId);

    await interaction.update({
      content: `✅ Webhook "${webhook.name}" removed.`,
      components: [],
    });

    this.context?.logger.info('[Config] Webhook removed via select', {
      userId,
      webhookName: webhook.name,
    });
  }

  /**
   * Handle webhook test select menu
   */
  private async handleWebhookTestSelect(interaction: SelectMenuInteraction, userId: number): Promise<void> {
    const webhookId = interaction.values[0];

    if (!webhookId) {
      await interaction.reply({
        content: '❌ No webhook selected.',
        ephemeral: true,
      });
      return;
    }

    const webhooks = getUserWebhooks(userId);
    const webhook = webhooks.find((w) => w.id === webhookId);

    if (!webhook) {
      await interaction.reply({
        content: '❌ Webhook not found.',
        ephemeral: true,
      });
      return;
    }

    // Clear the select menu first
    await interaction.deferUpdate();

    // Execute the test
    const config = getBotConfig();
    const botName = config?.bot?.name ?? 'Bot';
    const result = await testWebhook(webhook.url, botName);

    const response = result.success
      ? `✅ Webhook "${webhook.name}" test successful!\n\nA test image was sent to the webhook channel.`
      : `❌ Webhook "${webhook.name}" test failed:\n\n\`${result.error}\``;

    await interaction.update({
      content: response,
      components: [],
    });
  }
}

export default ConfigCommandPlugin;
