/**
 * Command Registry - Tracks registered slash commands
 *
 * Platform adapters query this to know what commands to register.
 */

import type { Platform } from './types/message';
import type {
  CommandRegistry as ICommandRegistry,
  RegisteredCommand,
  SlashCommandDefinition,
} from './types/slash-command';

/**
 * Implementation of the command registry
 */
class CommandRegistryImpl implements ICommandRegistry {
  private commands = new Map<string, RegisteredCommand>();

  register(command: SlashCommandDefinition, pluginId: string): void {
    if (this.commands.has(command.name)) {
      throw new Error(`Command "${command.name}" is already registered`);
    }

    this.commands.set(command.name, {
      ...command,
      pluginId,
      registeredAt: new Date(),
    });
  }

  unregister(commandName: string): void {
    this.commands.delete(commandName);
  }

  getAll(): RegisteredCommand[] {
    return Array.from(this.commands.values());
  }

  getForPlatform(platform: Platform): RegisteredCommand[] {
    return this.getAll().filter((cmd) => {
      // If no platforms specified, available on all
      if (!cmd.platforms || cmd.platforms.length === 0) {
        return true;
      }
      return cmd.platforms.includes(platform);
    });
  }

  get(commandName: string): RegisteredCommand | undefined {
    return this.commands.get(commandName);
  }

  has(commandName: string): boolean {
    return this.commands.has(commandName);
  }

  /**
   * Clear all commands (useful for testing or reload)
   */
  clear(): void {
    this.commands.clear();
  }

  /**
   * Get count of registered commands
   */
  count(): number {
    return this.commands.size;
  }
}

// Singleton instance
let registry: CommandRegistryImpl | null = null;

/**
 * Get the command registry instance
 */
export function getCommandRegistry(): ICommandRegistry & { clear(): void; count(): number } {
  if (!registry) {
    registry = new CommandRegistryImpl();
  }
  return registry;
}

/**
 * Register a slash command
 * Convenience function that uses the singleton registry
 */
export function registerCommand(command: SlashCommandDefinition, pluginId: string): void {
  getCommandRegistry().register(command, pluginId);
}

/**
 * Unregister a slash command
 */
export function unregisterCommand(commandName: string): void {
  getCommandRegistry().unregister(commandName);
}
