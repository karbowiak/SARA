/**
 * /profile plugin
 *
 * Allows users to view and manage their user profile
 * Subcommands: view, generate, edit, optout, optin
 */

import { generateProfile } from '@app/services/profile-generator';
import type { BotEmbed, CommandHandlerPlugin, CommandInvocation, ModalSubmitInteraction, PluginContext } from '@core';
import { registerCommand, unregisterCommand } from '@core';
import {
  canGenerateProfile,
  getProfile,
  getProfileByScope,
  getUserByPlatformId,
  isGlobalMemoryEnabled,
  setOptOut,
  upsertProfile,
} from '@core/database';
import { profileCommand } from './command';

export class ProfileCommandPlugin implements CommandHandlerPlugin {
  readonly id = 'profile';
  readonly type = 'command' as const;
  readonly commands = ['profile'];

  private context?: PluginContext;

  async load(context: PluginContext): Promise<void> {
    this.context = context;
    registerCommand(profileCommand, this.id);

    context.eventBus.on('command:received', this.handleCommand.bind(this));
    context.eventBus.on('interaction:modal', this.handleModal.bind(this));

    context.logger.info('ProfileCommandPlugin loaded');
  }

  async unload(): Promise<void> {
    unregisterCommand('profile');
    this.context?.logger.info('ProfileCommandPlugin unloaded');
  }

  private async handleCommand(invocation: CommandInvocation): Promise<void> {
    if (invocation.commandName !== 'profile') return;

    const { guildId, platform, user, subcommand } = invocation;

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
      case 'view':
        await this.handleView(invocation, dbUser.id, scope, isGlobal, user.displayName ?? user.name);
        break;
      case 'generate':
        await this.handleGenerate(invocation, dbUser.id, scope, isGlobal, user.displayName ?? user.name);
        break;
      case 'edit':
        await this.handleCorrect(invocation, dbUser.id, scope, isGlobal);
        break;
      case 'optout':
        await this.handleOptOut(invocation, dbUser.id, scope, isGlobal);
        break;
      case 'optin':
        await this.handleOptIn(invocation, dbUser.id, scope, isGlobal);
        break;
      default:
        await invocation.reply({
          content: '❌ Unknown subcommand',
          ephemeral: true,
        });
    }
  }

  /**
   * Handle /profile view
   */
  private async handleView(
    invocation: CommandInvocation,
    userId: number,
    scope: string,
    isGlobal: boolean,
    userName: string,
  ): Promise<void> {
    const profile = getProfileByScope(userId, isGlobal ? null : scope, isGlobal);

    if (!profile || !profile.last_generated_at) {
      await invocation.reply({
        content: '📭 No profile yet. Use `/profile generate` to create one!',
        ephemeral: true,
      });
      return;
    }

    const embed = this.buildProfileEmbed(profile, userName, isGlobal);

    await invocation.reply({
      embeds: [embed],
      ephemeral: true,
    });
  }

  /**
   * Handle /profile generate
   */
  private async handleGenerate(
    invocation: CommandInvocation,
    userId: number,
    scope: string,
    isGlobal: boolean,
    userName: string,
  ): Promise<void> {
    // Check rate limit
    const { canGenerate, nextAvailable } = canGenerateProfile(userId, isGlobal ? null : scope, isGlobal);

    if (!canGenerate && nextAvailable) {
      const hoursRemaining = Math.ceil((nextAvailable.getTime() - Date.now()) / (1000 * 60 * 60));
      await invocation.reply({
        content: `⏳ You can regenerate your profile in **${hoursRemaining}** hour${hoursRemaining === 1 ? '' : 's'}.`,
        ephemeral: true,
      });
      return;
    }

    // Defer since generation takes time
    await invocation.defer(true);

    try {
      const result = await generateProfile({
        userId,
        guildId: scope,
        userName,
        isGlobal,
      });

      if (!result.success) {
        await invocation.followUp({
          content: `❌ ${result.error || 'Failed to generate profile. Please try again later.'}`,
          ephemeral: true,
        });
        return;
      }

      if (!result.profile) {
        await invocation.followUp({
          content: '❌ Failed to generate profile. Please try again later.',
          ephemeral: true,
        });
        return;
      }

      const embed = this.buildProfileEmbed(result.profile, userName, isGlobal);
      const scopeLabel = isGlobal ? '🌐 Global' : '🏠 Server';

      await invocation.followUp({
        content: `✅ **Profile generated!** (${scopeLabel}) Analyzed ${result.messagesAnalyzed ?? 0} messages.`,
        embeds: [embed],
        ephemeral: true,
      });

      this.context?.logger.info('[Profile] Generated profile via slash command', {
        userId,
        scope,
        isGlobal,
        messagesAnalyzed: result.messagesAnalyzed,
      });
    } catch (error) {
      this.context?.logger.error('[Profile] Generation failed', { error });
      await invocation.followUp({
        content: '❌ An error occurred while generating your profile. Please try again later.',
        ephemeral: true,
      });
    }
  }

  /**
   * Handle /profile edit - opens modal for editing
   */
  private async handleCorrect(
    invocation: CommandInvocation,
    userId: number,
    scope: string,
    isGlobal: boolean,
  ): Promise<void> {
    const profile = getProfileByScope(userId, isGlobal ? null : scope, isGlobal);

    await invocation.showModal({
      customId: `profile_edit_modal_${isGlobal ? 'global' : scope}`,
      title: 'Edit Your Profile',
      fields: [
        {
          customId: 'summary',
          label: 'Summary',
          style: 'paragraph',
          required: false,
          maxLength: 2000,
          value: profile?.summary || '',
        },
        {
          customId: 'personality',
          label: 'Personality',
          style: 'paragraph',
          required: false,
          maxLength: 2000,
          value: profile?.personality || '',
        },
        {
          customId: 'interests',
          label: 'Interests',
          style: 'paragraph',
          required: false,
          maxLength: 2000,
          value: profile?.interests || '',
        },
        {
          customId: 'facts',
          label: 'Facts',
          style: 'paragraph',
          required: false,
          maxLength: 2000,
          value: profile?.facts || '',
        },
      ],
    });
  }

  /**
   * Handle /profile optout
   */
  private async handleOptOut(
    invocation: CommandInvocation,
    userId: number,
    scope: string,
    isGlobal: boolean,
  ): Promise<void> {
    setOptOut(userId, isGlobal ? null : scope, true, isGlobal);

    const scopeLabel = isGlobal ? 'globally' : 'in this context';
    await invocation.reply({
      content: `🔒 Profile features disabled ${scopeLabel}. Your profile will no longer be used or updated.`,
      ephemeral: true,
    });

    this.context?.logger.info('[Profile] User opted out', { userId, scope, isGlobal });
  }

  /**
   * Handle /profile optin
   */
  private async handleOptIn(
    invocation: CommandInvocation,
    userId: number,
    scope: string,
    isGlobal: boolean,
  ): Promise<void> {
    setOptOut(userId, isGlobal ? null : scope, false, isGlobal);

    const scopeLabel = isGlobal ? 'globally' : 'in this context';
    await invocation.reply({
      content: `✅ Profile features re-enabled ${scopeLabel}! Use \`/profile generate\` to update your profile.`,
      ephemeral: true,
    });

    this.context?.logger.info('[Profile] User opted in', { userId, scope, isGlobal });
  }

  /**
   * Handle modal submission for profile edit
   */
  private async handleModal(interaction: ModalSubmitInteraction): Promise<void> {
    if (!interaction.customId.startsWith('profile_edit_modal')) return;

    // Extract scope from customId: profile_edit_modal_<scope> or profile_edit_modal_global
    const scopePart = interaction.customId.replace('profile_edit_modal_', '');
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

    const summary = interaction.fields.summary?.trim() || null;
    const personality = interaction.fields.personality?.trim() || null;
    const interests = interaction.fields.interests?.trim() || null;
    const facts = interaction.fields.facts?.trim() || null;

    try {
      upsertProfile({
        userId: dbUser.id,
        guildId: scope,
        summary,
        personality,
        interests,
        facts,
        isGlobal,
      });

      const scopeLabel = isGlobal ? '🌐 Global' : '🏠 Server';
      await interaction.reply({
        content: `✅ **Profile updated!** (${scopeLabel}) Your edits have been saved.`,
        ephemeral: true,
      });

      this.context?.logger.info('[Profile] User edited profile via modal', {
        userId: dbUser.id,
        scope,
        isGlobal,
      });
    } catch (error) {
      this.context?.logger.error('[Profile] Failed to save profile edits', { error });
      await interaction.reply({
        content: '❌ Failed to save your profile changes. Please try again.',
        ephemeral: true,
      });
    }
  }

  /**
   * Build embed for profile display
   */
  private buildProfileEmbed(
    profile: {
      summary: string | null;
      personality: string | null;
      interests: string | null;
      facts: string | null;
      updated_at: number;
    },
    userName: string,
    isGlobal?: boolean,
  ): BotEmbed {
    const lastUpdatedDate = new Date(profile.updated_at);
    const lastUpdatedString = lastUpdatedDate.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    const scopeLabel = isGlobal ? '🌐 Global' : '🏠 Server';

    return {
      title: `${scopeLabel} Profile for ${userName}`,
      color: 0x5865f2, // Discord blurple
      fields: [
        { name: 'Summary', value: profile.summary || '*Not set*', inline: false },
        { name: 'Personality', value: profile.personality || '*Not set*', inline: false },
        { name: 'Interests', value: profile.interests || '*Not set*', inline: false },
        { name: 'Facts', value: profile.facts || '*Not set*', inline: false },
      ],
      footer: {
        text: `Last updated: ${lastUpdatedString}`,
      },
    };
  }
}

export default ProfileCommandPlugin;
