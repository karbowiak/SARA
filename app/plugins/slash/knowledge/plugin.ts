/**
 * /knowledge slash command plugin
 *
 * Manage the guild's shared knowledge base.
 */

import type {
  AutocompleteRequest,
  CommandHandlerPlugin,
  CommandInvocation,
  ModalSubmitInteraction,
  PluginContext,
} from '@core';
import { registerCommand, unregisterCommand } from '@core';
import {
  addKnowledge,
  deleteKnowledge,
  getGuildKnowledge,
  getKnowledge,
  getKnowledgeCount,
  getKnowledgeTags,
  getUserByPlatformId,
  searchKnowledge,
} from '@core/database';
import { knowledgeCommand } from './command';

export class KnowledgeCommandPlugin implements CommandHandlerPlugin {
  readonly id = 'knowledge';
  readonly type = 'command' as const;
  readonly commands = ['knowledge'];

  private context?: PluginContext;

  async load(context: PluginContext): Promise<void> {
    this.context = context;

    registerCommand(knowledgeCommand, this.id);

    context.eventBus.on('command:received', this.handleCommand.bind(this));
    context.eventBus.on('command:autocomplete', this.handleAutocomplete.bind(this));
    context.eventBus.on('interaction:modal', this.handleModal.bind(this));

    context.logger.info('KnowledgeCommandPlugin loaded');
  }

  async unload(): Promise<void> {
    unregisterCommand('knowledge');
    this.context?.logger.info('KnowledgeCommandPlugin unloaded');
    this.context = undefined;
  }

  private handleCommand = async (invocation: CommandInvocation): Promise<void> => {
    if (invocation.commandName !== 'knowledge') return;

    if (!invocation.guildId) {
      await invocation.reply({
        content: '❌ This command can only be used in a server.',
        ephemeral: true,
      });
      return;
    }

    switch (invocation.subcommand) {
      case 'add':
        await this.handleAdd(invocation);
        break;
      case 'search':
        await this.handleSearch(invocation);
        break;
      case 'list':
        await this.handleList(invocation);
        break;
      case 'get':
        await this.handleGet(invocation);
        break;
      case 'delete':
        await this.handleDelete(invocation);
        break;
      case 'tags':
        await this.handleTags(invocation);
        break;
      default:
        await invocation.reply({
          content: '❌ Unknown subcommand',
          ephemeral: true,
        });
    }
  };

  private async handleAdd(invocation: CommandInvocation): Promise<void> {
    // Check knowledge limit before showing modal
    const count = getKnowledgeCount(invocation.guildId!);
    if (count >= 1000) {
      await invocation.reply({
        content: '❌ This server has reached the maximum of 1000 knowledge entries. Please delete some entries first.',
        ephemeral: true,
      });
      return;
    }

    // Show modal for knowledge entry
    await invocation.showModal({
      customId: 'knowledge_add_modal',
      title: 'Add Knowledge',
      fields: [
        {
          customId: 'knowledge_content',
          label: 'Content',
          style: 'paragraph',
          placeholder:
            'Enter the knowledge content...\n\nExample: Server rules state that all members must be respectful.',
          required: true,
          minLength: 10,
          maxLength: 2000,
        },
        {
          customId: 'knowledge_tags',
          label: 'Tags (comma-separated, optional)',
          style: 'short',
          placeholder: 'rules, faq, important',
          required: false,
          maxLength: 200,
        },
      ],
    });
  }

  private handleModal = async (interaction: ModalSubmitInteraction): Promise<void> => {
    if (interaction.customId !== 'knowledge_add_modal') return;

    const guildId = interaction.guildId;
    if (!guildId) {
      await interaction.reply({
        content: '❌ This can only be used in a server.',
        ephemeral: true,
      });
      return;
    }

    const user = getUserByPlatformId('discord', interaction.user.id);
    if (!user) {
      await interaction.reply({
        content: '❌ Could not find your user record. Please send a message first.',
        ephemeral: true,
      });
      return;
    }

    const content = interaction.fields.knowledge_content ?? '';
    const tagsInput = interaction.fields.knowledge_tags ?? '';

    if (!content) {
      await interaction.reply({
        content: '❌ Content is required.',
        ephemeral: true,
      });
      return;
    }

    // Parse tags
    const tags = tagsInput
      ? tagsInput
          .split(',')
          .map((t) => t.trim().toLowerCase())
          .filter((t) => t.length > 0)
      : [];

    try {
      const entry = await addKnowledge({
        guildId,
        content,
        tags,
        addedBy: user.id,
      });

      let response = `✅ **Knowledge added!** (ID: ${entry.id})\n\n`;
      response += `📝 ${content.substring(0, 300)}${content.length > 300 ? '...' : ''}\n`;
      if (tags.length > 0) {
        response += `\n🏷️ Tags: ${tags.join(', ')}`;
      }

      await interaction.reply({ content: response, ephemeral: true });

      this.context?.logger.info('[Knowledge] Added entry via modal', {
        id: entry.id,
        guildId,
        userId: user.id,
        tags,
      });
    } catch (error) {
      this.context?.logger.error('[Knowledge] Failed to add entry', { error });
      await interaction.reply({
        content: '❌ Failed to add knowledge entry. Please try again.',
        ephemeral: true,
      });
    }
  };

  private async handleSearch(invocation: CommandInvocation): Promise<void> {
    const query = invocation.args.query as string;
    const tag = invocation.args.tag as string | undefined;

    try {
      const results = await searchKnowledge({
        guildId: invocation.guildId!,
        query,
        tag,
        limit: 5,
      });

      if (results.length === 0) {
        await invocation.reply({
          content: `📭 No results found for "${query}"${tag ? ` with tag "${tag}"` : ''}`,
          ephemeral: true,
        });
        return;
      }

      let response = `🔍 **Search Results** (${results.length})\n\n`;

      for (const entry of results) {
        const relevance = Math.round(entry.score * 100);
        const preview = entry.content.substring(0, 150);
        const tags = entry.tags.length > 0 ? ` [${entry.tags.join(', ')}]` : '';
        response += `**#${entry.id}** (${relevance}% match)${tags}\n`;
        response += `${preview}${entry.content.length > 150 ? '...' : ''}\n\n`;
      }

      response += `_Use \`/knowledge get id:<number>\` to see full content._`;

      await invocation.reply({ content: response, ephemeral: true });
    } catch (error) {
      this.context?.logger.error('[Knowledge] Search failed', { error });
      await invocation.reply({
        content: '❌ Search failed. Please try again.',
        ephemeral: true,
      });
    }
  }

  private async handleList(invocation: CommandInvocation): Promise<void> {
    const tag = invocation.args.tag as string | undefined;

    const entries = getGuildKnowledge(invocation.guildId!, { tag, limit: 15 });

    if (entries.length === 0) {
      await invocation.reply({
        content: tag
          ? `📭 No knowledge entries with tag "${tag}"`
          : '📭 No knowledge entries yet. Use `/knowledge add` to add some!',
        ephemeral: true,
      });
      return;
    }

    const totalCount = getKnowledgeCount(invocation.guildId!);
    let response = `📚 **Knowledge Base** (${entries.length}${totalCount > entries.length ? ` of ${totalCount}` : ''})\n\n`;

    for (const entry of entries) {
      const preview = entry.content.substring(0, 80);
      const tags = entry.tags.length > 0 ? ` [${entry.tags.join(', ')}]` : '';
      response += `**#${entry.id}**${tags}: ${preview}${entry.content.length > 80 ? '...' : ''}\n`;
    }

    if (totalCount > entries.length) {
      response += `\n_...and ${totalCount - entries.length} more. Use search or tag filters to narrow down._`;
    }

    await invocation.reply({ content: response, ephemeral: true });
  }

  private async handleGet(invocation: CommandInvocation): Promise<void> {
    const id = invocation.args.id as number;

    const entry = getKnowledge(id);
    if (!entry || entry.guild_id !== invocation.guildId) {
      await invocation.reply({
        content: `❌ Knowledge entry #${id} not found.`,
        ephemeral: true,
      });
      return;
    }

    let response = `📖 **Knowledge #${entry.id}**\n\n`;
    response += entry.content;
    if (entry.tags.length > 0) {
      response += `\n\n🏷️ Tags: ${entry.tags.join(', ')}`;
    }
    response += `\n📅 Added: <t:${Math.floor(entry.created_at / 1000)}:R>`;

    await invocation.reply({ content: response, ephemeral: true });
  }

  private async handleDelete(invocation: CommandInvocation): Promise<void> {
    const id = invocation.args.id as number;

    const entry = getKnowledge(id);
    if (!entry || entry.guild_id !== invocation.guildId) {
      await invocation.reply({
        content: `❌ Knowledge entry #${id} not found.`,
        ephemeral: true,
      });
      return;
    }

    const success = deleteKnowledge(id, invocation.guildId!);
    if (!success) {
      await invocation.reply({
        content: '❌ Failed to delete knowledge entry.',
        ephemeral: true,
      });
      return;
    }

    this.context?.logger.info('[Knowledge] Deleted entry', {
      id,
      guildId: invocation.guildId,
      deletedBy: invocation.user.id,
    });

    await invocation.reply({
      content: `✅ Deleted knowledge entry #${id}`,
      ephemeral: true,
    });
  }

  private async handleTags(invocation: CommandInvocation): Promise<void> {
    const tags = getKnowledgeTags(invocation.guildId!);

    if (tags.length === 0) {
      await invocation.reply({
        content: '📭 No tags found. Add knowledge entries with tags to see them here.',
        ephemeral: true,
      });
      return;
    }

    await invocation.reply({
      content: `🏷️ **Available Tags** (${tags.length})\n\n${tags.map((t) => `\`${t}\``).join(', ')}`,
      ephemeral: true,
    });
  }

  private handleAutocomplete = async (request: AutocompleteRequest): Promise<void> => {
    if (request.commandName !== 'knowledge') return;
    if (!request.guildId) return;

    const focusedName = request.focusedOption.name;
    const input = String(request.focusedOption.value || '').toLowerCase();

    if (focusedName === 'tag') {
      // Autocomplete tags
      const tags = getKnowledgeTags(request.guildId);
      const filtered = tags
        .filter((t) => !input || t.includes(input))
        .slice(0, 25)
        .map((t) => ({ name: t, value: t }));

      await request.respond(filtered);
    } else if (focusedName === 'id') {
      // Autocomplete knowledge IDs
      const entries = getGuildKnowledge(request.guildId, { limit: 50 });
      const filtered = entries
        .filter((e) => {
          if (!input) return true;
          return String(e.id).includes(input) || e.content.toLowerCase().includes(input);
        })
        .slice(0, 25)
        .map((e) => {
          const preview = e.content.substring(0, 60);
          const tags = e.tags.length > 0 ? ` [${e.tags[0]}]` : '';
          return {
            name: `#${e.id}${tags}: ${preview}${e.content.length > 60 ? '...' : ''}`.substring(0, 100),
            value: e.id,
          };
        });

      await request.respond(filtered);
    }
  };
}

export default KnowledgeCommandPlugin;
