/**
 * About Slash Command Plugin
 *
 * Displays bot information including:
 * - Current version from package.json
 * - Developer attribution
 * - GitHub source code repository
 * - OAuth2 invite link
 */

import {
  type CommandHandlerPlugin,
  type CommandInvocation,
  type PluginContext,
  registerCommand,
  unregisterCommand,
} from '@core';

export class AboutCommandPlugin implements CommandHandlerPlugin {
  readonly id = 'about';
  readonly type = 'command' as const;
  readonly commands = ['about'];

  private context?: PluginContext;

  async load(context: PluginContext): Promise<void> {
    this.context = context;

    // Register slash command (no options needed)
    registerCommand(
      {
        name: 'about',
        description: 'Display bot information',
        options: [],
      },
      this.id,
    );

    // Wire up command handler
    context.eventBus.on('command:received', this.handleCommand.bind(this));

    context.logger.info('AboutCommandPlugin loaded');
  }

  async unload(): Promise<void> {
    unregisterCommand('about');
    this.context?.logger.info('AboutCommandPlugin unloaded');
  }

  private handleCommand = async (invocation: CommandInvocation): Promise<void> => {
    if (invocation.commandName !== 'about') return;

    try {
      // Read version from package.json
      const version = await this.getVersion();

      // Get client ID for invite link (from raw interaction)
      const clientId = (invocation.raw as { client?: { user?: { id?: string } } })?.client?.user?.id;
      const inviteLink = clientId
        ? `https://discord.com/api/oauth2/authorize?client_id=${clientId}&permissions=274881571905&scope=bot`
        : null;

      // Build the embed
      const embed: import('@core').BotEmbed = {
        title: 'Bot Information',
        description: 'Sara is a Discord bot that aims to be a helpful assistant for your server.',
        color: 0x00ae86,
        fields: [
          { name: 'Version', value: version, inline: false },
          { name: 'Developer', value: '@lilllamah', inline: false },
          {
            name: 'Source Code',
            value: '[GitHub](github.com/karbowiak/SARA)',
            inline: false,
          },
          {
            name: 'Invite Link',
            value: inviteLink
              ? `[Invite me to your server](${inviteLink})\nRemember to talk to @lilllamah first, because if it's not whitelisted it cannot join.`
              : 'Unavailable',
            inline: false,
          },
        ],
        timestamp: new Date(),
      };

      // Reply with ephemeral embed
      await invocation.reply({
        embeds: [embed],
        ephemeral: true,
      });

      // Log invocation
      this.context?.logger.info('About command executed', {
        userId: invocation.user.id,
        guildId: invocation.guildId,
      });
    } catch (error) {
      this.context?.logger.error('Failed to handle about command', {
        error: error instanceof Error ? error.message : String(error),
      });

      try {
        await invocation.reply({
          content: '❌ Failed to retrieve bot information.',
          ephemeral: true,
        });
      } catch {
        // Interaction expired, ignore
      }
    }
  };

  /**
   * Read version from package.json
   * Falls back to "Unknown" if file cannot be read
   */
  private async getVersion(): Promise<string> {
    try {
      const packageJson = await Bun.file('package.json').json();
      return packageJson.version || 'Unknown';
    } catch (error) {
      this.context?.logger.warn('Failed to read package.json version', {
        error: error instanceof Error ? error.message : String(error),
      });
      return 'Unknown';
    }
  }
}

export default AboutCommandPlugin;
