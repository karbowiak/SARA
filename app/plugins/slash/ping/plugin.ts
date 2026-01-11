/**
 * Ping Command Plugin - Responds to /ping slash command
 *
 * Simple test command that responds with "Pong!" to verify
 * the slash command system is working.
 */

import {
  type CommandHandlerPlugin,
  type CommandInvocation,
  type PluginContext,
  registerCommand,
  type SlashCommandDefinition,
  unregisterCommand,
} from '@core';

const COMMAND_DEFINITION: SlashCommandDefinition = {
  name: 'ping',
  description: 'Replies with Pong! - Test if the bot is responsive',
};

export class PingCommandPlugin implements CommandHandlerPlugin {
  readonly id = 'ping';
  readonly type = 'command' as const;
  readonly commands = ['ping'];

  private context?: PluginContext;

  async load(context: PluginContext): Promise<void> {
    this.context = context;

    // Register the command definition
    registerCommand(COMMAND_DEFINITION, this.id);

    // Subscribe to command events
    context.eventBus.on('command:received', this.handleCommand.bind(this));

    context.logger.info('PingCommandPlugin loaded');
  }

  async unload(): Promise<void> {
    // Unregister command
    unregisterCommand('ping');

    this.context?.logger.info('PingCommandPlugin unloaded');
    this.context = undefined;
  }

  /**
   * Filter - only handle /ping commands
   */
  private handleCommand = async (invocation: CommandInvocation): Promise<void> => {
    if (invocation.commandName !== 'ping') return;
    await this.handle(invocation, this.context!);
  };

  /**
   * Handle the /ping command
   */
  async handle(invocation: CommandInvocation, context: PluginContext): Promise<void> {
    const startTime = Date.now();

    try {
      // Calculate latency
      const latency = Date.now() - startTime;

      await invocation.reply({
        content: `🏓 Pong! Latency: ${latency}ms`,
        ephemeral: true,
      });

      context.logger.info('Ping command executed', {
        plugin: this.id,
        userId: invocation.user.id,
        guildId: invocation.guildId,
        latency,
      });
    } catch (error) {
      context.logger.error('Failed to handle ping command', {
        plugin: this.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export default PingCommandPlugin;
