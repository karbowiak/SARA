/**
 * /profile plugin
 *
 * Allows users to view and manage their user profile
 * Subcommands: view, generate, edit, optout, optin
 */

import { generateProfile } from '@app/services/profile-generator';
import type { BotEmbed, CommandHandlerPlugin, CommandInvocation, ModalSubmitInteraction, PluginContext } from '@core';
import { registerCommand, unregisterCommand } from '@core';
import { canGenerateProfile, getProfile, getUserByPlatformId, setOptOut, upsertProfile } from '@core/database';
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
      case 'view':
        await this.handleView(invocation, dbUser.id, guildId, user.displayName ?? user.name);
        break;
      case 'generate':
        await this.handleGenerate(invocation, dbUser.id, guildId, user.displayName ?? user.name);
        break;
      case 'edit':
        await this.handleCorrect(invocation, dbUser.id, guildId);
        break;
      case 'optout':
        await this.handleOptOut(invocation, dbUser.id, guildId);
        break;
      case 'optin':
        await this.handleOptIn(invocation, dbUser.id, guildId);
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
    guildId: string,
    userName: string,
  ): Promise<void> {
    const profile = getProfile(userId, guildId);

    if (!profile || !profile.last_generated_at) {
      await invocation.reply({
        content: '📭 No profile yet. Use `/profile generate` to create one!',
        ephemeral: true,
      });
      return;
    }

    const embed = this.buildProfileEmbed(profile, userName);

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
    guildId: string,
    userName: string,
  ): Promise<void> {
    // Check rate limit
    const { canGenerate, nextAvailable } = canGenerateProfile(userId, guildId);

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
        guildId,
        userName,
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

      const embed = this.buildProfileEmbed(result.profile, userName);

      await invocation.followUp({
        content: `✅ **Profile generated!** Analyzed ${result.messagesAnalyzed ?? 0} messages.`,
        embeds: [embed],
        ephemeral: true,
      });

      this.context?.logger.info('[Profile] Generated profile via slash command', {
        userId,
        guildId,
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
  private async handleCorrect(invocation: CommandInvocation, userId: number, guildId: string): Promise<void> {
    const profile = getProfile(userId, guildId);

    await invocation.showModal({
      customId: 'profile_edit_modal',
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
  private async handleOptOut(invocation: CommandInvocation, userId: number, guildId: string): Promise<void> {
    setOptOut(userId, guildId, true);

    await invocation.reply({
      content: '🔒 Profile features disabled. Your profile will no longer be used or updated.',
      ephemeral: true,
    });

    this.context?.logger.info('[Profile] User opted out', { userId, guildId });
  }

  /**
   * Handle /profile optin
   */
  private async handleOptIn(invocation: CommandInvocation, userId: number, guildId: string): Promise<void> {
    setOptOut(userId, guildId, false);

    await invocation.reply({
      content: '✅ Profile features re-enabled! Use `/profile generate` to update your profile.',
      ephemeral: true,
    });

    this.context?.logger.info('[Profile] User opted in', { userId, guildId });
  }

  /**
   * Handle modal submission for profile edit
   */
  private async handleModal(interaction: ModalSubmitInteraction): Promise<void> {
    if (interaction.customId !== 'profile_edit_modal') return;

    const guildId = interaction.guildId;
    if (!guildId) {
      await interaction.reply({
        content: '❌ This can only be used in a server.',
        ephemeral: true,
      });
      return;
    }

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
        guildId,
        summary,
        personality,
        interests,
        facts,
      });

      await interaction.reply({
        content: '✅ **Profile updated!** Your edits have been saved.',
        ephemeral: true,
      });

      this.context?.logger.info('[Profile] User edited profile via modal', {
        userId: dbUser.id,
        guildId,
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
  ): BotEmbed {
    const lastUpdatedDate = new Date(profile.updated_at);
    const lastUpdatedString = lastUpdatedDate.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    return {
      title: `Profile for ${userName}`,
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
