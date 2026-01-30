/**
 * /memory plugin
 *
 * Allows users to view, manage, and clear their stored memories
 * Features: add with AI interpretation, pagination, autocomplete for delete, ephemeral responses
 */

import type {
  AutocompleteRequest,
  BotButton,
  ButtonInteraction,
  CommandHandlerPlugin,
  CommandInvocation,
  ModalSubmitInteraction,
  PluginContext,
} from '@core';
import { registerCommand, unregisterCommand } from '@core';
import { getBotConfig } from '@core/config';
import {
  clearGlobalMemories,
  clearMemories,
  deleteMemory,
  getMemories,
  getMemoryCount,
  getUserByPlatformId,
  isGlobalMemoryEnabled,
  type Memory,
  type MemoryType,
  saveMemory,
} from '@core/database';
import { LLMClient } from '@core/llm-client';
import { memoryCommand } from './command';

// Emoji icons for memory types
const TYPE_ICONS: Record<MemoryType, string> = {
  preference: '⚙️',
  fact: '📝',
  instruction: '📋',
  context: '💭',
  profile_update: '👤',
};

// Human-readable type names
const TYPE_NAMES: Record<MemoryType, string> = {
  preference: 'Preference',
  fact: 'Fact',
  instruction: 'Instruction',
  context: 'Context',
  profile_update: 'Profile Update',
};

const ITEMS_PER_PAGE = 5;

// Track pagination state per user
const paginationState = new Map<
  string,
  {
    memories: Memory[];
    page: number;
    typeFilter: MemoryType | null;
  }
>();

export class MemorySlashPlugin implements CommandHandlerPlugin {
  readonly id = 'memory';
  readonly type = 'command' as const;
  readonly commands = ['memory'];

  private context!: PluginContext;
  private llmClient?: LLMClient;

  async load(context: PluginContext): Promise<void> {
    this.context = context;

    // Initialize LLM client for memory interpretation
    const config = getBotConfig();
    if (config?.tokens?.openrouter) {
      this.llmClient = new LLMClient({
        apiKey: config.tokens.openrouter,
        defaultModel: config.ai?.defaultModel ?? 'anthropic/claude-sonnet-4-20250514',
        defaultTemperature: 0.3,
        defaultMaxTokens: 150,
      });
    }

    // Register the command definition
    registerCommand(memoryCommand, this.id);

    // Register event handlers
    context.eventBus.on('command:received', this.handleCommand.bind(this));
    context.eventBus.on('command:autocomplete', this.handleAutocomplete.bind(this));
    context.eventBus.on('interaction:button', this.handleButton.bind(this));
    context.eventBus.on('interaction:modal', this.handleModalSubmit.bind(this));

    context.logger.info('Memory command plugin loaded');
  }

  private async handleCommand(invocation: CommandInvocation): Promise<void> {
    if (invocation.commandName !== 'memory') return;

    const { guildId, platform, user, subcommand, args } = invocation;

    // Get user's internal ID
    const dbUser = getUserByPlatformId(platform, user.id);
    if (!dbUser) {
      await invocation.reply({
        content: '❌ You need to send at least one message before using this command.',
        ephemeral: true,
      });
      return;
    }

    // Determine scope based on user setting
    const isGlobal = isGlobalMemoryEnabled(dbUser.id);
    const scope = isGlobal ? 'global' : (guildId ?? 'dm');

    switch (subcommand) {
      case 'add':
        await this.handleAdd(invocation, dbUser.id, scope, isGlobal);
        break;
      case 'list':
        await this.handleList(invocation, dbUser.id, scope, isGlobal, (args.type as MemoryType) ?? null);
        break;
      case 'delete': {
        const memoryId = (args.memory as string) ?? '';
        await this.handleDelete(invocation, dbUser.id, scope, memoryId);
        break;
      }
      case 'clear':
        await this.handleClear(invocation, dbUser.id, scope, isGlobal);
        break;
      default:
        await invocation.reply({
          content: '❌ Unknown subcommand',
          ephemeral: true,
        });
    }
  }

  private async handleAutocomplete(request: AutocompleteRequest): Promise<void> {
    if (request.commandName !== 'memory') return;
    if (request.focusedOption.name !== 'memory') return;

    const { platform, user, guildId } = request;

    const dbUser = getUserByPlatformId(platform, user.id);
    if (!dbUser) {
      await request.respond([]);
      return;
    }

    // Get memories based on user's scope setting
    const isGlobal = isGlobalMemoryEnabled(dbUser.id);
    const scope = isGlobal ? null : (guildId ?? 'dm'); // null for global fetches all global + guild memories

    const memories = getMemories(dbUser.id, scope);
    const search = request.focusedOption.value.toLowerCase();

    const matches = memories
      .filter((m) => m.content.toLowerCase().includes(search) || m.id.toString().includes(search))
      .slice(0, 25)
      .map((m) => {
        const scopeIcon = m.is_global ? '🌐' : '🏠';
        return {
          name: `${scopeIcon} ${TYPE_ICONS[m.type]} #${m.id}: ${m.content.slice(0, 70)}${m.content.length > 70 ? '...' : ''}`,
          value: m.id.toString(),
        };
      });

    await request.respond(matches);
  }

  private async handleButton(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.customId.startsWith('memory_')) return;

    const [_, action, _page] = interaction.customId.split('_');
    const userId = interaction.user.id;
    const state = paginationState.get(userId);

    if (!state) {
      await interaction.reply({
        content: '❌ Session expired. Please run `/memory list` again.',
        ephemeral: true,
      });
      return;
    }

    const newPage = action === 'next' ? state.page + 1 : state.page - 1;
    state.page = newPage;
    paginationState.set(userId, state);

    const { content, components } = this.buildListResponse(state.memories, newPage, state.typeFilter);

    await interaction.update({
      content,
      components,
    });
  }

  private async handleAdd(
    invocation: CommandInvocation,
    userId: number,
    scope: string,
    isGlobal: boolean,
  ): Promise<void> {
    // Check memory limit before showing modal
    const { explicit } = getMemoryCount(userId, isGlobal ? null : scope);
    if (explicit >= 100) {
      await invocation.reply({
        content: '❌ You have reached the maximum of 100 explicit memories. Use `/memory delete` to remove some first.',
        ephemeral: true,
      });
      return;
    }

    // Show modal for memory entry
    await invocation.showModal({
      customId: `memory_add_modal_${isGlobal ? 'global' : scope}`,
      title: 'Add Memory',
      fields: [
        {
          customId: 'memory_content',
          label: 'What should I remember?',
          style: 'paragraph',
          placeholder: 'e.g., "I prefer dark mode" or "My timezone is EST"',
          required: true,
          minLength: 3,
          maxLength: 500,
        },
        {
          customId: 'memory_type',
          label: 'Type (preference/fact/instruction/context)',
          style: 'short',
          placeholder: 'fact',
          required: false,
          maxLength: 20,
        },
      ],
    });
  }

  private handleModalSubmit = async (interaction: ModalSubmitInteraction): Promise<void> => {
    if (!interaction.customId.startsWith('memory_add_modal')) return;

    // Extract scope from customId: memory_add_modal_<scope> or memory_add_modal_global
    const scopePart = interaction.customId.replace('memory_add_modal_', '');
    const isGlobal = scopePart === 'global';
    const scope = isGlobal ? 'global' : scopePart;

    const dbUser = getUserByPlatformId('discord', interaction.user.id);
    if (!dbUser) {
      await interaction.reply({
        content: '❌ Could not find your user record. Please send a message first.',
        ephemeral: true,
      });
      return;
    }

    const content = interaction.fields.memory_content ?? '';
    const typeInput = (interaction.fields.memory_type || 'fact').toLowerCase().trim();

    if (!content) {
      await interaction.reply({
        content: '❌ Content is required.',
        ephemeral: true,
      });
      return;
    }

    // Validate type
    const validTypes = ['preference', 'fact', 'instruction', 'context'];
    const type: MemoryType = validTypes.includes(typeInput) ? (typeInput as MemoryType) : 'fact';

    // Defer response to avoid timeout during AI processing
    await interaction.defer(true);

    // AI interpretation
    let finalContent = content;
    let wasInterpreted = false;

    if (this.llmClient) {
      try {
        const interpreted = await this.interpretMemory(
          content,
          type,
          interaction.user.displayName ?? interaction.user.name,
        );
        if (interpreted) {
          finalContent = interpreted;
          wasInterpreted = true;
        }
      } catch (error) {
        this.context.logger.warn('[Memory] AI interpretation failed, using raw content', { error });
      }
    }

    try {
      const result = await saveMemory({
        userId: dbUser.id,
        guildId: scope,
        type,
        content: finalContent,
        source: 'explicit',
        isGlobal,
      });

      const scopeLabel = isGlobal ? '🌐 Global' : '🏠 This server';
      let response = result.updated
        ? `🔄 **Memory updated!** (similar memory existed)\n\n`
        : `✅ **Memory saved!** (${scopeLabel})\n\n`;

      response += `${TYPE_ICONS[type]} **${TYPE_NAMES[type]}**\n`;
      response += `${finalContent}\n`;

      if (wasInterpreted && finalContent !== content) {
        response += `\n_Original: "${content}"_\n`;
        response += `_Interpreted for clarity_`;
      }

      await interaction.followUp({ content: response, ephemeral: true });

      this.context.logger.info('[Memory] Added via modal', {
        userId: dbUser.id,
        scope,
        type,
        isGlobal,
        interpreted: wasInterpreted,
      });
    } catch (error) {
      this.context.logger.error('[Memory] Failed to save', { error });
      await interaction.followUp({
        content: '❌ Failed to save memory. Please try again.',
        ephemeral: true,
      });
    }
  };

  /**
   * Use AI to rephrase user input into a clear, actionable memory
   */
  private async interpretMemory(input: string, type: MemoryType, username: string): Promise<string | null> {
    if (!this.llmClient) return null;

    const typeDescriptions: Record<MemoryType, string> = {
      preference: 'a user preference (likes, dislikes, preferences)',
      fact: 'a factual statement about the user',
      instruction: 'an instruction for how to interact with the user',
      context: 'current contextual information',
      profile_update: 'a flag to update the user profile',
    };

    try {
      const response = await this.llmClient.chat({
        messages: [
          {
            role: 'system',
            content: `You are a memory formatter. Rephrase user input into a clear, concise memory statement.

Rules:
- Output ONLY the rephrased memory, nothing else
- Keep it concise (under 100 characters if possible)
- Write in third person about the user (use "User" or their name)
- Make it specific and actionable
- Preserve the core meaning
- If the input is already clear, you may return it unchanged

Memory type: ${typeDescriptions[type]}
User's name: ${username}`,
          },
          {
            role: 'user',
            content: input,
          },
        ],
      });

      const result = response.choices[0]?.message?.content;
      const resultStr = typeof result === 'string' ? result.trim() : null;
      return resultStr && resultStr.length > 0 && resultStr.length < 500 ? resultStr : null;
    } catch {
      return null;
    }
  }

  private async handleList(
    invocation: CommandInvocation,
    userId: number,
    scope: string,
    isGlobal: boolean,
    typeFilter: MemoryType | null,
  ): Promise<void> {
    const memories = getMemories(userId, isGlobal ? null : scope);

    // Filter by type if specified
    const filtered = typeFilter ? memories.filter((m) => m.type === typeFilter) : memories;

    if (filtered.length === 0) {
      const filterText = typeFilter ? ` of type "${typeFilter}"` : '';
      const scopeText = isGlobal ? '' : ' in this context';
      await invocation.reply({
        content: `📭 You have no memories${filterText}${scopeText}.\n\nTo create memories, just tell me things like "Remember that I prefer dark mode" or "My timezone is EST".`,
        ephemeral: true,
      });
      return;
    }

    // Store pagination state
    paginationState.set(invocation.user.id, {
      memories: filtered,
      page: 0,
      typeFilter,
    });

    const { content, components } = this.buildListResponse(filtered, 0, typeFilter, isGlobal);

    await invocation.reply({
      content,
      components,
      ephemeral: true,
    });
  }

  private buildListResponse(
    memories: Memory[],
    page: number,
    typeFilter: MemoryType | null,
    isGlobal?: boolean,
  ): { content: string; components: BotButton[][] } {
    const totalPages = Math.ceil(memories.length / ITEMS_PER_PAGE);
    const start = page * ITEMS_PER_PAGE;
    const pageMemories = memories.slice(start, start + ITEMS_PER_PAGE);

    // Group page memories by type
    const grouped = new Map<MemoryType, Memory[]>();
    for (const memory of pageMemories) {
      const list = grouped.get(memory.type) || [];
      list.push(memory);
      grouped.set(memory.type, list);
    }

    // Build response
    const filterText = typeFilter ? ` (${TYPE_NAMES[typeFilter]}s only)` : '';
    let content = `📚 **Your Memories**${filterText} — ${memories.length} total\n\n`;

    for (const [type, typeMemories] of grouped) {
      content += `${TYPE_ICONS[type]} **${TYPE_NAMES[type]}s**\n`;

      for (const memory of typeMemories) {
        const source = memory.source === 'explicit' ? '✅' : '🔄';
        const scopeIcon = memory.is_global ? '🌐' : '🏠';
        content += `${scopeIcon} ${source} \`#${memory.id}\` ${memory.content}\n`;
      }
      content += '\n';
    }

    content += `_Page ${page + 1}/${totalPages} • 🌐 global | 🏠 server • ✅ explicit | 🔄 inferred_`;

    // Build pagination buttons
    const buttons: BotButton[] = [];

    if (page > 0) {
      buttons.push({
        type: 'button',
        customId: `memory_prev_${page}`,
        label: '← Previous',
        style: 'secondary',
      });
    }

    if (page < totalPages - 1) {
      buttons.push({
        type: 'button',
        customId: `memory_next_${page}`,
        label: 'Next →',
        style: 'secondary',
      });
    }

    return {
      content,
      components: buttons.length > 0 ? [buttons] : [],
    };
  }

  private async handleDelete(
    invocation: CommandInvocation,
    userId: number,
    scope: string,
    memoryIdStr: string,
  ): Promise<void> {
    const memoryId = parseInt(memoryIdStr, 10);

    if (Number.isNaN(memoryId)) {
      await invocation.reply({
        content: '❌ Invalid memory ID.',
        ephemeral: true,
      });
      return;
    }

    // Verify this memory belongs to the user (check both global and scope-specific)
    const memories = getMemories(userId, scope === 'global' ? null : scope);
    const memory = memories.find((m) => m.id === memoryId);

    if (!memory) {
      await invocation.reply({
        content: `❌ Memory #${memoryId} not found, or it doesn't belong to you.`,
        ephemeral: true,
      });
      return;
    }

    const deleted = deleteMemory(memoryId);

    if (deleted) {
      const scopeLabel = memory.is_global ? '🌐 Global' : '🏠 Server';
      this.context.logger.info('User deleted memory via slash command', {
        userId,
        scope,
        memoryId,
      });

      await invocation.reply({
        content: `✅ **Memory deleted!** (${scopeLabel})\n\n${TYPE_ICONS[memory.type]} ~~${memory.content}~~\n\n_I'll no longer remember this._`,
        ephemeral: true,
      });
    } else {
      await invocation.reply({
        content: `❌ Failed to delete memory #${memoryId}. Please try again.`,
        ephemeral: true,
      });
    }
  }

  private async handleClear(
    invocation: CommandInvocation,
    userId: number,
    scope: string,
    isGlobal: boolean,
  ): Promise<void> {
    const memories = getMemories(userId, isGlobal ? null : scope);

    if (memories.length === 0) {
      const scopeText = isGlobal ? '' : ' in this context';
      await invocation.reply({
        content: `📭 You have no memories to clear${scopeText}.`,
        ephemeral: true,
      });
      return;
    }

    // Clear based on scope
    let count: number;
    let scopeLabel: string;

    if (isGlobal) {
      count = clearGlobalMemories(userId);
      scopeLabel = 'globally';
    } else {
      count = clearMemories(userId, scope);
      scopeLabel = scope === 'dm' ? 'from DMs' : 'from this server';
    }

    this.context.logger.info('User cleared memories via slash command', {
      userId,
      scope,
      isGlobal,
      clearedCount: count,
    });

    await invocation.reply({
      content: `🗑️ **Memories cleared ${scopeLabel}!**\n\nRemoved **${count}** ${count === 1 ? 'memory' : 'memories'}.\n\n_Starting fresh — I won't remember this data until you tell me again._`,
      ephemeral: true,
    });
  }

  async unload(): Promise<void> {
    unregisterCommand('memory');
    paginationState.clear();
    this.context.logger.info('Memory command plugin unloaded');
  }
}
