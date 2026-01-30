/**
 * /migrate command plugin
 *
 * Handles migration of memories and profiles between servers or to global scope.
 */

import {
  type AutocompleteRequest,
  type BotButton,
  type ButtonInteraction,
  type CommandHandlerPlugin,
  type CommandInvocation,
  type PluginContext,
  registerCommand,
  unregisterCommand,
} from '@core';
import {
  getGlobalMemoryCount,
  getGuildMemoryCount,
  getUserByPlatformId,
  hasGlobalProfile,
  hasGuildProfile,
  migrateMemoriesToGlobal,
  migrateMemoriesToGuild,
  migrateProfileToGlobal,
  migrateProfileToGuild,
} from '@core/database';
import { migrateCommand } from './command';

export class MigrateCommandPlugin implements CommandHandlerPlugin {
  readonly id = 'migrate';
  readonly type = 'command' as const;
  readonly commands = ['migrate'];

  private context!: PluginContext;

  async load(context: PluginContext): Promise<void> {
    this.context = context;

    registerCommand(migrateCommand, this.id);

    context.eventBus.on('command:received', this.handleCommand.bind(this));
    context.eventBus.on('command:autocomplete', this.handleAutocomplete.bind(this));
    context.eventBus.on('interaction:button', this.handleButton.bind(this));

    context.logger.info('[Migrate] Plugin loaded');
  }

  async unload(): Promise<void> {
    unregisterCommand('migrate');
    this.context.logger.info('[Migrate] Plugin unloaded');
  }

  private async handleCommand(invocation: CommandInvocation): Promise<void> {
    if (invocation.commandName !== 'migrate') return;

    const { guildId, platform, user, subcommand, args } = invocation;

    // Must be in a guild (command is guildOnly, but double-check)
    if (!guildId) {
      await invocation.reply({
        content: '❌ This command can only be used in a server.',
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

    const destination = args.destination as string;

    switch (subcommand) {
      case 'memory':
        await this.handleMigrateMemory(invocation, dbUser.id, guildId, destination);
        break;
      case 'profile':
        await this.handleMigrateProfile(invocation, dbUser.id, guildId, destination);
        break;
      default:
        await invocation.reply({
          content: '❌ Unknown subcommand',
          ephemeral: true,
        });
    }
  }

  private async handleAutocomplete(request: AutocompleteRequest): Promise<void> {
    if (request.commandName !== 'migrate') return;
    if (request.focusedOption.name !== 'destination') return;

    const search = request.focusedOption.value.toLowerCase();

    // Build choices: "global" + hint for server ID
    const choices: { name: string; value: string }[] = [];

    // Always offer global as first option
    if ('global'.includes(search) || search === '') {
      choices.push({
        name: '🌐 Global (shared everywhere)',
        value: 'global',
      });
    }

    // If they're typing something that looks like a server ID, offer it
    if (search.length > 10 && /^\d+$/.test(search)) {
      choices.push({
        name: `🏠 Server ID: ${search}`,
        value: search,
      });
    }

    // Add a hint about server IDs
    if (search === '' || 'server'.includes(search)) {
      choices.push({
        name: '💡 Tip: Paste a server ID to migrate there',
        value: 'hint',
      });
    }

    await request.respond(choices.slice(0, 25));
  }

  /**
   * Handle button interactions for confirmation
   */
  private async handleButton(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.customId.startsWith('migrate_')) return;

    // Parse: migrate_<action>_<type>_<userId>_<fromGuildId>_<destination>
    const parts = interaction.customId.split('_');
    if (parts.length < 6) return;

    const action = parts[1];
    const type = parts[2];
    const userIdStr = parts[3];
    const fromGuildId = parts[4];
    const destination = parts[5];

    // Validate all parts exist
    if (!action || !type || !userIdStr || !fromGuildId || !destination) return;

    const userId = parseInt(userIdStr, 10);

    if (action === 'cancel') {
      await interaction.update({
        content: '❌ Migration cancelled.',
        components: [],
      });
      return;
    }

    if (action !== 'confirm') return;

    // Perform the migration
    if (type === 'memory') {
      let count: number;
      let destLabel: string;

      if (destination === 'global') {
        count = migrateMemoriesToGlobal(userId, fromGuildId);
        destLabel = '🌐 Global';
      } else {
        count = migrateMemoriesToGuild(userId, fromGuildId, destination);
        destLabel = `🏠 Server (${destination})`;
      }

      if (count > 0) {
        await interaction.update({
          content: `✅ **Memories migrated!**\n\nMoved **${count}** ${count === 1 ? 'memory' : 'memories'} to ${destLabel}.\n\nYour memories from this server are now accessible ${destination === 'global' ? 'everywhere' : 'in the destination server'}.`,
          components: [],
        });

        this.context.logger.info('[Migrate] Memories migrated', {
          userId,
          fromGuildId,
          destination,
          count,
        });
      } else {
        await interaction.update({
          content: '❌ No memories were migrated. They may have already been moved.',
          components: [],
        });
      }
    } else if (type === 'profile') {
      const destHasProfile = destination === 'global' ? hasGlobalProfile(userId) : hasGuildProfile(userId, destination);
      let success: boolean;
      let destLabel: string;

      if (destination === 'global') {
        success = migrateProfileToGlobal(userId, fromGuildId);
        destLabel = '🌐 Global';
      } else {
        success = migrateProfileToGuild(userId, fromGuildId, destination);
        destLabel = `🏠 Server (${destination})`;
      }

      if (success) {
        const mergeNote = destHasProfile ? ' (merged with existing profile)' : '';
        await interaction.update({
          content: `✅ **Profile migrated!**\n\nYour profile has been moved to ${destLabel}${mergeNote}.\n\nYour profile is now accessible ${destination === 'global' ? 'everywhere' : 'in the destination server'}.`,
          components: [],
        });

        this.context.logger.info('[Migrate] Profile migrated', {
          userId,
          fromGuildId,
          destination,
          merged: destHasProfile,
        });
      } else {
        await interaction.update({
          content: '❌ Failed to migrate profile. It may have already been moved.',
          components: [],
        });
      }
    }
  }

  /**
   * Handle /migrate memory
   */
  private async handleMigrateMemory(
    invocation: CommandInvocation,
    userId: number,
    fromGuildId: string,
    destination: string,
  ): Promise<void> {
    // Check if there are memories to migrate
    const memoryCount = getGuildMemoryCount(userId, fromGuildId);

    if (memoryCount === 0) {
      await invocation.reply({
        content: '📭 You have no memories in this server to migrate.',
        ephemeral: true,
      });
      return;
    }

    // Check if destination already has memories
    let destMemoryCount: number;
    let destLabel: string;

    if (destination === 'global') {
      destMemoryCount = getGlobalMemoryCount(userId);
      destLabel = '🌐 Global';
    } else {
      destMemoryCount = getGuildMemoryCount(userId, destination);
      destLabel = `🏠 Server (${destination})`;
    }

    // Build warning message
    const warnings: string[] = [];

    warnings.push(
      `**${memoryCount}** ${memoryCount === 1 ? 'memory' : 'memories'} from this server will be moved to ${destLabel}.`,
    );
    warnings.push(`**This server's memories will be deleted** after migration.`);

    if (destMemoryCount > 0) {
      warnings.push(
        `\n⚠️ **Note:** The destination already has **${destMemoryCount}** ${destMemoryCount === 1 ? 'memory' : 'memories'}. Your memories will be added to them.`,
      );
    }

    // Show confirmation with buttons
    const confirmBtn: BotButton = {
      type: 'button',
      style: 'danger',
      label: 'Yes, migrate',
      customId: `migrate_confirm_memory_${userId}_${fromGuildId}_${destination}`,
    };
    const cancelBtn: BotButton = {
      type: 'button',
      style: 'secondary',
      label: 'Cancel',
      customId: `migrate_cancel_memory_${userId}_${fromGuildId}_${destination}`,
    };

    await invocation.reply({
      content: `## Migrate Memories?\n\n${warnings.join('\n')}\n\nAre you sure you want to proceed?`,
      ephemeral: true,
      components: [[confirmBtn, cancelBtn]],
    });
  }

  /**
   * Handle /migrate profile
   */
  private async handleMigrateProfile(
    invocation: CommandInvocation,
    userId: number,
    fromGuildId: string,
    destination: string,
  ): Promise<void> {
    // Check if there's a profile to migrate
    if (!hasGuildProfile(userId, fromGuildId)) {
      await invocation.reply({
        content: '📭 You have no profile in this server to migrate.',
        ephemeral: true,
      });
      return;
    }

    // Check destination for existing profile
    let destHasProfile: boolean;
    let destLabel: string;

    if (destination === 'global') {
      destHasProfile = hasGlobalProfile(userId);
      destLabel = '🌐 Global';
    } else {
      destHasProfile = hasGuildProfile(userId, destination);
      destLabel = `🏠 Server (${destination})`;
    }

    // Build warning message
    const warnings: string[] = [];

    warnings.push(`Your profile from this server will be moved to ${destLabel}.`);
    warnings.push(`**This server's profile will be deleted** after migration.`);

    if (destHasProfile) {
      warnings.push(
        `\n⚠️ **Warning:** The destination already has a profile. The profiles will be **merged** (destination profile will be overwritten with this server's data).`,
      );
    }

    // Show confirmation with buttons
    const confirmBtn: BotButton = {
      type: 'button',
      style: 'danger',
      label: 'Yes, migrate',
      customId: `migrate_confirm_profile_${userId}_${fromGuildId}_${destination}`,
    };
    const cancelBtn: BotButton = {
      type: 'button',
      style: 'secondary',
      label: 'Cancel',
      customId: `migrate_cancel_profile_${userId}_${fromGuildId}_${destination}`,
    };

    await invocation.reply({
      content: `## Migrate Profile?\n\n${warnings.join('\n')}\n\nAre you sure you want to proceed?`,
      ephemeral: true,
      components: [[confirmBtn, cancelBtn]],
    });
  }
}

export default MigrateCommandPlugin;
