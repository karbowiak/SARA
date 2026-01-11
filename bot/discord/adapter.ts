/**
 * Discord Adapter - Translates Discord events to platform-agnostic events
 */

import type {
  AutocompleteRequest,
  BotChannel,
  BotConfig,
  BotEmbed,
  BotMessage,
  BotUser,
  ButtonInteraction,
  CommandInvocation,
  CommandResponse,
  EventBus,
  FeatureAccess,
  Logger,
  ModalSubmitInteraction,
  SelectMenuInteraction,
} from '@core';
import { checkAccess, getCommandRegistry } from '@core';
import {
  type ActionRowBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  Client,
  type ButtonInteraction as DiscordButtonInteraction,
  type ModalSubmitInteraction as DiscordModalSubmitInteraction,
  Events,
  GatewayIntentBits,
  type Interaction,
  type Message,
  type MessageActionRowComponentBuilder,
  MessageFlags,
  type StringSelectMenuInteraction,
  type User,
} from 'discord.js';

export interface DiscordAdapterOptions {
  token: string;
  eventBus: EventBus;
  logger: Logger;
  config?: BotConfig;
  /** Access config for plugins (plugin ID → access rules) */
  pluginAccess?: Map<string, FeatureAccess>;
}

/**
 * Discord platform adapter
 *
 * Converts Discord.js events to normalized events and vice versa.
 */
export class DiscordAdapter {
  private client: Client;
  private eventBus: EventBus;
  private logger: Logger;
  private config?: BotConfig;
  private pluginAccess: Map<string, FeatureAccess>;

  constructor(options: DiscordAdapterOptions) {
    this.eventBus = options.eventBus;
    this.logger = options.logger;
    this.config = options.config;
    this.pluginAccess = options.pluginAccess ?? new Map();

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.DirectMessages,
      ],
    });

    this.setupIncomingEvents();
    this.setupOutgoingEvents();
  }

  /**
   * Connect to Discord
   */
  async connect(token: string): Promise<void> {
    this.logger.info('Discord adapter connecting...');

    await this.client.login(token);
  }

  /**
   * Disconnect from Discord
   */
  async disconnect(): Promise<void> {
    this.logger.info('Discord adapter disconnecting...');
    this.client.destroy();
  }

  /**
   * Get the Discord client (for advanced use)
   */
  getClient(): Client {
    return this.client;
  }

  // ============================================
  // Incoming Events (Discord → EventBus)
  // ============================================

  private setupIncomingEvents(): void {
    // Ready
    this.client.once(Events.ClientReady, (client) => {
      this.logger.info(`Discord connected as ${client.user.tag}`);
      this.eventBus.fire('bot:ready', { platform: 'discord' });
    });

    // Message received
    this.client.on(Events.MessageCreate, (message) => {
      // Ignore own messages
      if (message.author.id === this.client.user?.id) return;

      this.eventBus.fire('message:received', this.transformMessage(message));
    });

    // Message updated
    this.client.on(Events.MessageUpdate, (_old, newMessage) => {
      if (newMessage.partial) return;
      if (newMessage.author?.id === this.client.user?.id) return;

      this.eventBus.fire('message:updated', this.transformMessage(newMessage as Message));
    });

    // Message deleted
    this.client.on(Events.MessageDelete, (message) => {
      this.eventBus.fire('message:deleted', {
        messageId: message.id,
        channelId: message.channelId,
        platform: 'discord',
      });
    });

    // Reaction added
    this.client.on(Events.MessageReactionAdd, (reaction, user) => {
      if (user.bot) return;

      this.eventBus.fire('reaction:added', {
        messageId: reaction.message.id,
        channelId: reaction.message.channelId,
        emoji: reaction.emoji.name ?? reaction.emoji.id ?? '❓',
        userId: user.id,
        platform: 'discord',
      });
    });

    // Reaction removed
    this.client.on(Events.MessageReactionRemove, (reaction, user) => {
      this.eventBus.fire('reaction:removed', {
        messageId: reaction.message.id,
        channelId: reaction.message.channelId,
        emoji: reaction.emoji.name ?? reaction.emoji.id ?? '❓',
        userId: user.id,
        platform: 'discord',
      });
    });

    // Interaction events (slash commands, buttons, etc.)
    this.client.on(Events.InteractionCreate, (interaction) => {
      this.handleInteraction(interaction);
    });

    // Error handling
    this.client.on(Events.Error, (error) => {
      this.logger.error('Discord client error', { error: error.message });
      this.eventBus.fire('bot:error', { error, context: 'discord' });
    });
  }

  // ============================================
  // Outgoing Events (EventBus → Discord)
  // ============================================

  private setupOutgoingEvents(): void {
    // Track active typing per channel with reference counting
    const typingState = new Map<string, { count: number; interval: NodeJS.Timeout }>();

    // Send message
    this.eventBus.on('message:send', async (request) => {
      if (request.platform !== 'discord') return;

      try {
        const channel = await this.client.channels.fetch(request.channelId);
        if (!channel?.isTextBased() || !('send' in channel)) {
          this.logger.warn('Cannot send to non-text channel', { channelId: request.channelId });
          return;
        }

        // Build Discord message options
        const messageOptions: {
          content?: string;
          reply?: { messageReference: string };
          files?: Array<{ attachment: Buffer | string; name: string }>;
          components?: any[];
        } = {};

        if (request.message.content) {
          messageOptions.content = request.message.content;
        }

        if (request.message.replyToId) {
          messageOptions.reply = { messageReference: request.message.replyToId };
        }

        // Handle file attachments
        if (request.message.attachments && request.message.attachments.length > 0) {
          messageOptions.files = request.message.attachments.map((att) => ({
            attachment: att.data,
            name: att.filename,
          }));
        }

        // Handle components (buttons, selects)
        if (request.message.components && request.message.components.length > 0) {
          messageOptions.components = this.transformComponents(request.message.components);
        }

        await channel.send(messageOptions);

        // Log outgoing message to terminal
        this.logOutgoingMessage(channel, request.message.content, request.message.attachments?.length);
      } catch (error) {
        this.logger.error('Failed to send message', {
          channelId: request.channelId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    // Start typing indicator (reference counted)
    this.eventBus.on('typing:start', async (request) => {
      if (request.platform !== 'discord') return;

      const existing = typingState.get(request.channelId);
      if (existing) {
        // Already typing in this channel, just increment count
        existing.count++;
        return;
      }

      try {
        const channel = await this.client.channels.fetch(request.channelId);
        if (!channel?.isTextBased() || !('sendTyping' in channel)) return;

        // Send initial typing
        await channel.sendTyping();

        // Set up interval to keep typing indicator alive (Discord timeout is ~10s)
        const interval = setInterval(async () => {
          try {
            if ('sendTyping' in channel) {
              await channel.sendTyping();
            }
          } catch {
            // Ignore errors refreshing typing
          }
        }, 8000);

        // Store with count of 1
        typingState.set(request.channelId, { count: 1, interval });
      } catch (error) {
        this.logger.error('Failed to start typing', {
          channelId: request.channelId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    // Stop typing indicator (reference counted)
    this.eventBus.on('typing:stop', (request) => {
      if (request.platform !== 'discord') return;

      const state = typingState.get(request.channelId);
      if (!state) return;

      state.count--;

      // Only clear interval when all requests are done
      if (state.count <= 0) {
        clearInterval(state.interval);
        typingState.delete(request.channelId);
      }
    });

    // Add reaction
    this.eventBus.on('reaction:add', async (reaction) => {
      if (reaction.platform !== 'discord') return;

      try {
        const channel = await this.client.channels.fetch(reaction.channelId);
        if (!channel?.isTextBased()) return;

        const message = await channel.messages.fetch(reaction.messageId);
        await message.react(reaction.emoji);
      } catch (error) {
        this.logger.error('Failed to add reaction', {
          messageId: reaction.messageId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    // Fetch message content
    this.eventBus.on('message:fetch', async (request) => {
      if (request.platform !== 'discord') return;

      try {
        const channel = await this.client.channels.fetch(request.channelId);
        if (!channel?.isTextBased() || !('messages' in channel)) {
          request.callback(null);
          return;
        }

        const message = await channel.messages.fetch(request.messageId);
        request.callback(message.content);
      } catch (error) {
        this.logger.debug('Failed to fetch message', {
          messageId: request.messageId,
          error: error instanceof Error ? error.message : String(error),
        });
        request.callback(null);
      }
    });

    // Send DM to a user
    this.eventBus.on('dm:send', async (request) => {
      if (request.platform !== 'discord') return;

      try {
        const user = await this.client.users.fetch(request.userId);
        const dmChannel = await user.createDM();

        // Build message options
        const messageOptions: {
          content?: string;
          files?: Array<{ attachment: Buffer | string; name: string }>;
          components?: ActionRowBuilder<MessageActionRowComponentBuilder>[];
        } = {};

        if (request.message.content) {
          messageOptions.content = request.message.content;
        }

        if (request.message.attachments && request.message.attachments.length > 0) {
          messageOptions.files = request.message.attachments.map((att) => ({
            attachment: att.data,
            name: att.filename,
          }));
        }

        if (request.message.components && request.message.components.length > 0) {
          messageOptions.components = this.transformComponents(
            request.message.components,
          ) as ActionRowBuilder<MessageActionRowComponentBuilder>[];
        }

        await dmChannel.send(messageOptions);

        // Log outgoing DM
        this.logOutgoingDM(user.username, request.message.content);
      } catch (error) {
        this.logger.error('Failed to send DM', {
          userId: request.userId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }

  // ============================================
  // Transformers
  // ============================================

  private transformMessage(message: Message): BotMessage {
    const botId = this.client.user?.id;
    const mentionedBot = botId ? message.mentions.users.has(botId) || message.content.includes(`<@${botId}>`) : false;

    // Get author's role IDs from guild member
    const authorRoleIds = message.member?.roles.cache.map((r) => r.id);

    return {
      id: message.id,
      content: message.content,
      author: this.transformUser(message.author, authorRoleIds),
      channel: this.transformChannel(message),
      attachments: message.attachments.map((a) => ({
        id: a.id,
        filename: a.name,
        url: a.url,
        contentType: a.contentType ?? undefined,
        size: a.size,
      })),
      guildId: message.guildId ?? undefined,
      guildName: message.guild?.name ?? undefined,
      mentionedUserIds: message.mentions.users.map((u) => u.id),
      mentionedUsers: message.mentions.users.map((u) => this.transformUser(u)),
      mentionedBot,
      replyToId: message.reference?.messageId ?? undefined,
      timestamp: message.createdAt,
      platform: 'discord',
      raw: message,
    };
  }

  private transformUser(user: User, roleIds?: string[]): BotUser {
    return {
      id: user.id,
      name: user.username,
      displayName: user.displayName ?? user.username,
      isBot: user.bot,
      avatarUrl: user.displayAvatarURL(),
      roleIds,
    };
  }

  private transformChannel(message: Message): BotChannel {
    const channel = message.channel;

    return {
      id: channel.id,
      name: 'name' in channel ? (channel.name ?? undefined) : undefined,
      type: message.guildId ? 'guild' : 'dm',
    };
  }

  /**
   * Log outgoing bot message to terminal in same format as incoming messages
   */
  private logOutgoingMessage(
    channel: { id: string; guild?: { name: string } | null } & { name?: string },
    content?: string,
    attachmentCount?: number,
  ): void {
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
    const guild = channel.guild?.name ?? 'DM';
    const channelName = channel.name ?? channel.id;
    const botName = this.config?.bot.name ?? 'Bot';

    // Truncate long messages for terminal display
    let displayContent = content ?? '';
    if (displayContent.length > 200) {
      displayContent = `${displayContent.substring(0, 200)}...`;
    }

    // Add attachment indicator
    if (attachmentCount && attachmentCount > 0) {
      displayContent = displayContent
        ? `${displayContent} [${attachmentCount} attachment(s)]`
        : `[${attachmentCount} attachment(s)]`;
    }

    // ANSI colors (matching logger.plugin.ts)
    const dim = '\x1b[2m';
    const reset = '\x1b[0m';
    const yellow = '\x1b[33m';
    const blue = '\x1b[34m';
    const magenta = '\x1b[35m';
    const white = '\x1b[37m';

    // Format: [HH:MM:SS] Guild/#channel │ BotName [BOT]: message
    console.log(
      `${dim}[${timestamp}]${reset} ` +
        `${yellow}${guild}${reset}${dim}/${reset}${blue}#${channelName}${reset} ` +
        `${dim}│${reset} ${magenta}${botName}${reset} ${magenta}[BOT]${reset}` +
        `${dim}:${reset} ${white}${displayContent}${reset}`,
    );
  }

  /**
   * Log outgoing DM to terminal
   */
  private logOutgoingDM(username: string, content?: string): void {
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
    const botName = this.config?.bot.name ?? 'Bot';

    // Truncate long messages for terminal display
    let displayContent = content ?? '';
    if (displayContent.length > 200) {
      displayContent = `${displayContent.substring(0, 200)}...`;
    }

    // ANSI colors
    const dim = '\x1b[2m';
    const reset = '\x1b[0m';
    const cyan = '\x1b[36m';
    const magenta = '\x1b[35m';
    const white = '\x1b[37m';

    // Format: [HH:MM:SS] DM → @username │ BotName [BOT]: message
    console.log(
      `${dim}[${timestamp}]${reset} ` +
        `${magenta}DM${reset} ${dim}→${reset} ${cyan}@${username}${reset} ` +
        `${dim}│${reset} ${magenta}${botName}${reset} ${magenta}[BOT]${reset}` +
        `${dim}:${reset} ${white}${displayContent}${reset}`,
    );
  }

  // ============================================
  // Interaction Handling
  // ============================================

  private handleInteraction(interaction: Interaction): void {
    if (interaction.isChatInputCommand()) {
      this.handleSlashCommand(interaction);
    } else if (interaction.isAutocomplete()) {
      this.handleAutocomplete(interaction);
    } else if (interaction.isButton()) {
      this.handleButton(interaction);
    } else if (interaction.isStringSelectMenu()) {
      this.handleSelectMenu(interaction);
    } else if (interaction.isModalSubmit()) {
      this.handleModalSubmit(interaction);
    }
  }

  private handleSlashCommand(interaction: ChatInputCommandInteraction): void {
    // Extract subcommand info
    const subcommandGroup = interaction.options.getSubcommandGroup(false);
    const subcommand = interaction.options.getSubcommand(false);

    // Extract all options
    const args: Record<string, unknown> = {};
    for (const option of interaction.options.data) {
      if (option.type === 1 || option.type === 2) {
        // Subcommand or SubcommandGroup - extract nested options
        for (const subOption of option.options ?? []) {
          args[subOption.name] = subOption.value;
        }
      } else {
        args[option.name] = option.value;
      }
    }

    const invocation: CommandInvocation = {
      commandName: interaction.commandName,
      subcommand: subcommand ?? undefined,
      subcommandGroup: subcommandGroup ?? undefined,
      args,
      user: {
        id: interaction.user.id,
        name: interaction.user.username,
        displayName: interaction.user.displayName ?? interaction.user.username,
        isBot: interaction.user.bot,
        avatarUrl: interaction.user.displayAvatarURL(),
      },
      channel: {
        id: interaction.channelId,
        name:
          interaction.channel && 'name' in interaction.channel ? (interaction.channel.name ?? undefined) : undefined,
        type: interaction.guildId ? 'guild' : 'dm',
      },
      guildId: interaction.guildId ?? undefined,
      platform: 'discord',
      raw: interaction,
      reply: async (response: CommandResponse) => {
        await interaction.reply({
          content: response.content,
          embeds: response.embeds?.map((e) => this.transformEmbed(e)),
          components: response.components ? (this.transformComponents(response.components) as any) : undefined,
          flags: response.ephemeral ? MessageFlags.Ephemeral : undefined,
          files: response.attachments?.map((att) => ({
            attachment: att.data,
            name: att.filename,
          })),
        });
      },
      defer: async (ephemeral?: boolean) => {
        await interaction.deferReply({
          flags: ephemeral ? MessageFlags.Ephemeral : undefined,
        });
      },
      followUp: async (response: CommandResponse) => {
        await interaction.followUp({
          content: response.content,
          embeds: response.embeds?.map((e) => this.transformEmbed(e)),
          components: response.components ? (this.transformComponents(response.components) as any) : undefined,
          flags: response.ephemeral ? MessageFlags.Ephemeral : undefined,
          files: response.attachments?.map((att) => ({
            attachment: att.data,
            name: att.filename,
          })),
        });
      },
      showModal: async (modal) => {
        const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');

        const discordModal = new ModalBuilder().setCustomId(modal.customId).setTitle(modal.title);

        for (const field of modal.fields) {
          const input = new TextInputBuilder()
            .setCustomId(field.customId)
            .setLabel(field.label)
            .setStyle(field.style === 'paragraph' ? TextInputStyle.Paragraph : TextInputStyle.Short)
            .setRequired(field.required ?? true);

          if (field.placeholder) input.setPlaceholder(field.placeholder);
          if (field.value) input.setValue(field.value);
          if (field.minLength) input.setMinLength(field.minLength);
          if (field.maxLength) input.setMaxLength(field.maxLength);

          discordModal.addComponents(new ActionRowBuilder().addComponents(input));
        }

        await interaction.showModal(discordModal);
      },
    };

    // Check access control before emitting event
    const accessConfig = this.pluginAccess.get(interaction.commandName);
    if (accessConfig) {
      // Get user's role IDs from guild member
      const roleIds = interaction.member?.roles
        ? Array.isArray(interaction.member.roles)
          ? interaction.member.roles
          : [...interaction.member.roles.cache.keys()]
        : [];

      const accessContext = {
        platform: 'discord' as const,
        userId: interaction.user.id,
        roleIds,
        guildId: interaction.guildId ?? undefined,
      };

      // Check subcommand-specific access if applicable
      let effectiveAccess = accessConfig;
      if (subcommand && accessConfig.subcommands?.[subcommand]) {
        effectiveAccess = accessConfig.subcommands[subcommand];
      }

      if (!checkAccess(effectiveAccess, accessContext, this.config)) {
        // Deny access with ephemeral message
        const commandPath = subcommand ? `/${interaction.commandName} ${subcommand}` : `/${interaction.commandName}`;
        interaction.reply({
          content: `❌ You do not have permission to use ${commandPath}.`,
          flags: MessageFlags.Ephemeral,
        });
        this.logger.debug(`Access denied for command ${commandPath}`, {
          user: interaction.user.username,
          userId: interaction.user.id,
          guildId: interaction.guildId,
        });
        return;
      }
    }

    this.eventBus.fire('command:received', invocation);
  }

  private handleAutocomplete(interaction: AutocompleteInteraction): void {
    const focused = interaction.options.getFocused(true);

    const request: AutocompleteRequest = {
      commandName: interaction.commandName,
      subcommand: interaction.options.getSubcommand(false) ?? undefined,
      subcommandGroup: interaction.options.getSubcommandGroup(false) ?? undefined,
      focusedOption: {
        name: focused.name,
        value: String(focused.value),
      },
      options: {},
      user: {
        id: interaction.user.id,
        name: interaction.user.username,
        displayName: interaction.user.displayName ?? interaction.user.username,
        isBot: interaction.user.bot,
      },
      channel: {
        id: interaction.channelId,
        name:
          interaction.channel && 'name' in interaction.channel ? (interaction.channel.name ?? undefined) : undefined,
        type: interaction.guildId ? 'guild' : 'dm',
      },
      guildId: interaction.guildId ?? undefined,
      platform: 'discord',
      raw: interaction,
      respond: async (choices) => {
        await interaction.respond(choices.slice(0, 25).map((c) => ({ name: c.name, value: String(c.value) })));
      },
    };

    this.eventBus.fire('command:autocomplete', request);
  }

  private handleButton(interaction: DiscordButtonInteraction): void {
    const buttonInteraction: ButtonInteraction = {
      customId: interaction.customId,
      user: {
        id: interaction.user.id,
        name: interaction.user.username,
        displayName: interaction.user.displayName ?? interaction.user.username,
        isBot: interaction.user.bot,
      },
      channel: {
        id: interaction.channelId,
        name:
          interaction.channel && 'name' in interaction.channel ? (interaction.channel.name ?? undefined) : undefined,
        type: interaction.guildId ? 'guild' : 'dm',
      },
      messageId: interaction.message.id,
      guildId: interaction.guildId ?? undefined,
      platform: 'discord',
      raw: interaction,
      update: async (response) => {
        await interaction.update({
          content: response.content,
          embeds: response.embeds?.map((e) => this.transformEmbed(e)),
          components: response.components ? (this.transformComponents(response.components) as any) : undefined,
        });
      },
      deferUpdate: async () => {
        await interaction.deferUpdate();
      },
      reply: async (response) => {
        await interaction.reply({
          content: response.content,
          embeds: response.embeds?.map((e) => this.transformEmbed(e)),
          components: response.components ? (this.transformComponents(response.components) as any) : undefined,
          flags: response.ephemeral ? MessageFlags.Ephemeral : undefined,
        });
      },
    };

    this.eventBus.fire('interaction:button', buttonInteraction);
  }

  private handleSelectMenu(interaction: StringSelectMenuInteraction): void {
    const selectInteraction: SelectMenuInteraction = {
      customId: interaction.customId,
      values: interaction.values,
      user: {
        id: interaction.user.id,
        name: interaction.user.username,
        displayName: interaction.user.displayName ?? interaction.user.username,
        isBot: interaction.user.bot,
      },
      channel: {
        id: interaction.channelId,
        name:
          interaction.channel && 'name' in interaction.channel ? (interaction.channel.name ?? undefined) : undefined,
        type: interaction.guildId ? 'guild' : 'dm',
      },
      messageId: interaction.message.id,
      guildId: interaction.guildId ?? undefined,
      platform: 'discord',
      raw: interaction,
      update: async (response) => {
        await interaction.update({
          content: response.content,
          embeds: response.embeds?.map((e) => this.transformEmbed(e)),
          components: response.components ? (this.transformComponents(response.components) as any) : undefined,
        });
      },
      deferUpdate: async () => {
        await interaction.deferUpdate();
      },
      reply: async (response) => {
        await interaction.reply({
          content: response.content,
          embeds: response.embeds?.map((e) => this.transformEmbed(e)),
          components: response.components ? (this.transformComponents(response.components) as any) : undefined,
          flags: response.ephemeral ? MessageFlags.Ephemeral : undefined,
        });
      },
    };

    this.eventBus.fire('interaction:select', selectInteraction);
  }

  private handleModalSubmit(interaction: DiscordModalSubmitInteraction): void {
    // Extract field values
    const fields: Record<string, string> = {};
    for (const [key, component] of interaction.fields.fields) {
      if ('value' in component) {
        fields[key] = component.value;
      }
    }

    const modalInteraction: ModalSubmitInteraction = {
      customId: interaction.customId,
      fields,
      user: {
        id: interaction.user.id,
        name: interaction.user.username,
        displayName: interaction.user.displayName ?? interaction.user.username,
        isBot: interaction.user.bot,
      },
      channel: {
        id: interaction.channelId!,
        name:
          interaction.channel && 'name' in interaction.channel ? (interaction.channel.name ?? undefined) : undefined,
        type: interaction.guildId ? 'guild' : 'dm',
      },
      guildId: interaction.guildId ?? undefined,
      platform: 'discord',
      raw: interaction,
      reply: async (response) => {
        await interaction.reply({
          content: response.content,
          embeds: response.embeds?.map((e) => this.transformEmbed(e)),
          flags: response.ephemeral ? MessageFlags.Ephemeral : undefined,
        });
      },
      defer: async (ephemeral?: boolean) => {
        await interaction.deferReply({
          flags: ephemeral ? MessageFlags.Ephemeral : undefined,
        });
      },
    };

    this.eventBus.fire('interaction:modal', modalInteraction);
  }

  private transformEmbed(embed: BotEmbed): Record<string, unknown> {
    return {
      title: embed.title,
      description: embed.description,
      color: embed.color,
      url: embed.url,
      timestamp: embed.timestamp?.toISOString(),
      footer: embed.footer ? { text: embed.footer.text, icon_url: embed.footer.iconUrl } : undefined,
      thumbnail: embed.thumbnail ? { url: embed.thumbnail.url } : undefined,
      image: embed.image ? { url: embed.image.url } : undefined,
      author: embed.author
        ? {
            name: embed.author.name,
            url: embed.author.url,
            icon_url: embed.author.iconUrl,
          }
        : undefined,
      fields: embed.fields,
    };
  }

  private transformComponents(components: import('@core').BotComponent[][]): unknown[] {
    const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');

    const styleMap: Record<string, number> = {
      primary: ButtonStyle.Primary,
      secondary: ButtonStyle.Secondary,
      success: ButtonStyle.Success,
      danger: ButtonStyle.Danger,
      link: ButtonStyle.Link,
    };

    return components.map((row) => {
      const actionRow = new ActionRowBuilder();

      for (const component of row) {
        if (component.type === 'button') {
          const button = new ButtonBuilder()
            .setCustomId(component.style === 'link' ? undefined : component.customId)
            .setLabel(component.label)
            .setStyle(styleMap[component.style] ?? ButtonStyle.Secondary)
            .setDisabled(component.disabled ?? false);

          if (component.url && component.style === 'link') {
            button.setURL(component.url);
          }
          if (component.emoji) {
            button.setEmoji(component.emoji);
          }

          actionRow.addComponents(button);
        } else if (component.type === 'select') {
          const select = new StringSelectMenuBuilder()
            .setCustomId(component.customId)
            .setPlaceholder(component.placeholder ?? 'Select an option')
            .addOptions(
              component.options.map((opt) => ({
                label: opt.label,
                value: opt.value,
                description: opt.description,
                emoji: opt.emoji,
                default: opt.default,
              })),
            );

          if (component.minValues !== undefined) select.setMinValues(component.minValues);
          if (component.maxValues !== undefined) select.setMaxValues(component.maxValues);
          if (component.disabled) select.setDisabled(true);

          actionRow.addComponents(select);
        }
      }

      return actionRow;
    });
  }

  // ============================================
  // Slash Command Registration
  // ============================================

  /**
   * Register all slash commands with Discord
   * Call this after all plugins have loaded
   */
  async registerSlashCommands(): Promise<void> {
    const registry = getCommandRegistry();
    const commands = registry.getForPlatform('discord');

    if (commands.length === 0) {
      this.logger.info('No slash commands to register');
      return;
    }

    try {
      const discordCommands = commands.map((cmd) => this.transformCommand(cmd));

      await this.client.application?.commands.set(
        discordCommands as unknown as Parameters<typeof this.client.application.commands.set>[0],
      );

      this.logger.info(`Registered ${commands.length} slash command(s)`, {
        commands: commands.map((c) => c.name),
      });
    } catch (error) {
      this.logger.error('Failed to register slash commands', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private transformCommand(cmd: import('@core').RegisteredCommand): Record<string, unknown> {
    const result: Record<string, unknown> = {
      name: cmd.name,
      description: cmd.description,
    };

    if (cmd.options && cmd.options.length > 0) {
      result.options = cmd.options.map((opt) => this.transformOption(opt));
    }

    if (cmd.subcommands && cmd.subcommands.length > 0) {
      result.options = cmd.subcommands.map((sub) => ({
        type: 1, // SUB_COMMAND
        name: sub.name,
        description: sub.description,
        options: sub.options?.map((opt) => this.transformOption(opt)),
      }));
    }

    if (cmd.subcommandGroups && cmd.subcommandGroups.length > 0) {
      result.options = cmd.subcommandGroups.map((group) => ({
        type: 2, // SUB_COMMAND_GROUP
        name: group.name,
        description: group.description,
        options: group.subcommands.map((sub) => ({
          type: 1,
          name: sub.name,
          description: sub.description,
          options: sub.options?.map((opt) => this.transformOption(opt)),
        })),
      }));
    }

    if (cmd.dmOnly) {
      result.dm_permission = true;
    }

    return result;
  }

  private transformOption(opt: import('@core').SlashOption): Record<string, unknown> {
    const typeMap: Record<string, number> = {
      string: 3,
      integer: 4,
      boolean: 5,
      user: 6,
      channel: 7,
      role: 8,
      number: 10,
      attachment: 11,
    };

    const result: Record<string, unknown> = {
      type: typeMap[opt.type] ?? 3,
      name: opt.name,
      description: opt.description,
      required: opt.required ?? false,
    };

    if (opt.choices) {
      result.choices = opt.choices;
    }

    if (opt.autocomplete) {
      result.autocomplete = true;
    }

    if (opt.minValue !== undefined) {
      result.min_value = opt.minValue;
    }

    if (opt.maxValue !== undefined) {
      result.max_value = opt.maxValue;
    }

    if (opt.minLength !== undefined) {
      result.min_length = opt.minLength;
    }

    if (opt.maxLength !== undefined) {
      result.max_length = opt.maxLength;
    }

    return result;
  }
}
