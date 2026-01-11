/**
 * /memory plugin
 *
 * Allows users to view, manage, and clear their stored memories
 * Features: pagination, autocomplete for delete, ephemeral responses
 */

import type {
  AutocompleteRequest,
  BotButton,
  ButtonInteraction,
  CommandHandlerPlugin,
  CommandInvocation,
  PluginContext,
} from '@core';
import { registerCommand, unregisterCommand } from '@core';
import {
  clearMemories,
  deleteMemory,
  getMemories,
  getUserByPlatformId,
  type Memory,
  type MemoryType,
} from '@core/database';
import { memoryCommand } from './command';

// Emoji icons for memory types
const TYPE_ICONS: Record<MemoryType, string> = {
  preference: '⚙️',
  fact: '📝',
  instruction: '📋',
  context: '💭',
};

// Human-readable type names
const TYPE_NAMES: Record<MemoryType, string> = {
  preference: 'Preference',
  fact: 'Fact',
  instruction: 'Instruction',
  context: 'Context',
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
  readonly id = 'memory-command';
  readonly type = 'command' as const;
  readonly commands = ['memory'];

  private context!: PluginContext;

  async load(context: PluginContext): Promise<void> {
    this.context = context;

    // Register the command definition
    registerCommand(memoryCommand, this.id);

    // Register event handlers
    context.eventBus.on('command:received', this.handleCommand.bind(this));
    context.eventBus.on('command:autocomplete', this.handleAutocomplete.bind(this));
    context.eventBus.on('interaction:button', this.handleButton.bind(this));

    context.logger.info('Memory command plugin loaded');
  }

  private async handleCommand(invocation: CommandInvocation): Promise<void> {
    if (invocation.commandName !== 'memory') return;

    const { guildId, platform, user, options } = invocation;
    const subcommand = options?.getSubcommand();

    // Must be in a guild
    if (!guildId) {
      await invocation.reply({
        content: '❌ This command can only be used in a server, not DMs.',
        ephemeral: true,
      });
      return;
    }

    // Get user's internal ID
    const dbUser = getUserByPlatformId(platform, user.id);
    if (!dbUser) {
      await invocation.reply({
        content: '❌ You need to send at least one message before using this command.',
        ephemeral: true,
      });
      return;
    }

    switch (subcommand) {
      case 'list':
        await this.handleList(invocation, dbUser.id, guildId, options?.getString('type') as MemoryType | null);
        break;
      case 'delete': {
        const memoryId = options?.getString('memory', true) ?? '';
        await this.handleDelete(invocation, dbUser.id, guildId, memoryId);
        break;
      }
      case 'clear':
        await this.handleClear(invocation, dbUser.id, guildId);
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
    if (!guildId) {
      await request.respond([]);
      return;
    }

    const dbUser = getUserByPlatformId(platform, user.id);
    if (!dbUser) {
      await request.respond([]);
      return;
    }

    const memories = getMemories(dbUser.id, guildId);
    const search = request.focusedOption.value.toLowerCase();

    const matches = memories
      .filter((m) => m.content.toLowerCase().includes(search) || m.id.toString().includes(search))
      .slice(0, 25)
      .map((m) => ({
        name: `${TYPE_ICONS[m.type]} #${m.id}: ${m.content.slice(0, 80)}${m.content.length > 80 ? '...' : ''}`,
        value: m.id.toString(),
      }));

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

  private async handleList(
    invocation: CommandInvocation,
    userId: number,
    guildId: string,
    typeFilter: MemoryType | null,
  ): Promise<void> {
    const memories = getMemories(userId, guildId);

    // Filter by type if specified
    const filtered = typeFilter ? memories.filter((m) => m.type === typeFilter) : memories;

    if (filtered.length === 0) {
      const filterText = typeFilter ? ` of type "${typeFilter}"` : '';
      await invocation.reply({
        content: `📭 You have no memories${filterText} stored in this server.\n\nTo create memories, just tell me things like "Remember that I prefer dark mode" or "My timezone is EST".`,
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

    const { content, components } = this.buildListResponse(filtered, 0, typeFilter);

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
        content += `${source} \`#${memory.id}\` ${memory.content}\n`;
      }
      content += '\n';
    }

    content += `_Page ${page + 1}/${totalPages} • ✅ explicit | 🔄 inferred_`;

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
    guildId: string,
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

    // Verify this memory belongs to the user in this guild
    const memories = getMemories(userId, guildId);
    const memory = memories.find((m) => m.id === memoryId);

    if (!memory) {
      await invocation.reply({
        content: `❌ Memory #${memoryId} not found, or it doesn't belong to you in this server.`,
        ephemeral: true,
      });
      return;
    }

    const deleted = deleteMemory(memoryId);

    if (deleted) {
      this.context.logger.info('User deleted memory via slash command', {
        userId,
        guildId,
        memoryId,
      });

      await invocation.reply({
        content: `✅ **Memory deleted!**\n\n${TYPE_ICONS[memory.type]} ~~${memory.content}~~\n\n_I'll no longer remember this._`,
        ephemeral: true,
      });
    } else {
      await invocation.reply({
        content: `❌ Failed to delete memory #${memoryId}. Please try again.`,
        ephemeral: true,
      });
    }
  }

  private async handleClear(invocation: CommandInvocation, userId: number, guildId: string): Promise<void> {
    const memories = getMemories(userId, guildId);

    if (memories.length === 0) {
      await invocation.reply({
        content: '📭 You have no memories to clear in this server.',
        ephemeral: true,
      });
      return;
    }

    const count = clearMemories(userId, guildId);

    this.context.logger.info('User cleared all memories via slash command', {
      userId,
      guildId,
      clearedCount: count,
    });

    await invocation.reply({
      content: `🗑️ **All memories cleared!**\n\nRemoved **${count}** ${count === 1 ? 'memory' : 'memories'} from this server.\n\n_Starting fresh — I won't remember anything about you until you tell me again._`,
      ephemeral: true,
    });
  }

  async unload(): Promise<void> {
    unregisterCommand('memory');
    paginationState.clear();
    this.context.logger.info('Memory command plugin unloaded');
  }
}
