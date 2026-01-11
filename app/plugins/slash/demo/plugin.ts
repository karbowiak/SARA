/**
 * Demo Command Plugin - Showcases all interaction types
 *
 * /demo autocomplete - Test autocomplete functionality
 * /demo buttons - Test button interactions
 * /demo select - Test select menu interactions
 * /demo modal - Test modal interactions
 * /demo embed - Test embeds with components
 */

import {
  type CommandHandlerPlugin,
  type CommandInvocation,
  type PluginContext,
  registerCommand,
  unregisterCommand,
} from '@core';
// Import handlers
import { handleAutocomplete, handleAutocompleteCommand } from './autocomplete';
import { handleButton, handleButtonsCommand } from './buttons';
// Import command definition
import { COMMAND_DEFINITION } from './command';
import { handleEmbedCommand } from './embed';
import { handleModal, handleModalCommand } from './modal';
import { handleSelect, handleSelectCommand } from './select';

export class DemoCommandPlugin implements CommandHandlerPlugin {
  readonly id = 'demo-command';
  readonly type = 'command' as const;
  readonly commands = ['demo'];

  private context?: PluginContext;

  async load(context: PluginContext): Promise<void> {
    this.context = context;

    // Register command definition
    registerCommand(COMMAND_DEFINITION, this.id);

    // Wire up event handlers
    context.eventBus.on('command:received', this.handleCommand.bind(this));
    context.eventBus.on('command:autocomplete', handleAutocomplete);
    context.eventBus.on('interaction:button', handleButton);
    context.eventBus.on('interaction:select', handleSelect);
    context.eventBus.on('interaction:modal', (interaction) => handleModal(interaction, context.logger));

    context.logger.info('DemoCommandPlugin loaded');
  }

  async unload(): Promise<void> {
    unregisterCommand('demo');
    this.context?.logger.info('DemoCommandPlugin unloaded');
    this.context = undefined;
  }

  private handleCommand = async (invocation: CommandInvocation): Promise<void> => {
    if (invocation.commandName !== 'demo') return;

    switch (invocation.subcommand) {
      case 'autocomplete':
        await handleAutocompleteCommand(invocation);
        break;
      case 'buttons':
        await handleButtonsCommand(invocation);
        break;
      case 'select':
        await handleSelectCommand(invocation);
        break;
      case 'modal':
        await handleModalCommand(invocation);
        break;
      case 'embed':
        await handleEmbedCommand(invocation);
        break;
      default:
        await invocation.reply({
          content: 'Unknown subcommand. Use: autocomplete, buttons, select, modal, or embed',
          ephemeral: true,
        });
    }
  };
}

export default DemoCommandPlugin;
