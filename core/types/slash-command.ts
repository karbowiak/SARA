/**
 * Slash Command Types - Platform-agnostic command definitions
 *
 * These types define how slash commands are structured.
 * Platform adapters (Discord, Slack) translate these to their native formats.
 */

import type { Platform } from './message';

/**
 * Option types supported by slash commands
 * Maps to Discord ApplicationCommandOptionType and Slack block kit elements
 */
export type SlashOptionType =
  | 'string' // Text input
  | 'integer' // Whole numbers
  | 'number' // Decimal numbers
  | 'boolean' // True/false
  | 'user' // User mention/picker
  | 'channel' // Channel picker
  | 'role' // Role picker (Discord-specific, ignored on Slack)
  | 'attachment'; // File upload

/**
 * Choice for string/integer/number options
 */
export interface SlashOptionChoice {
  /** Display name */
  name: string;
  /** Actual value */
  value: string | number;
}

/**
 * Option definition for a slash command
 */
export interface SlashOption {
  /** Option name (lowercase, no spaces) */
  name: string;
  /** Description shown to users */
  description: string;
  /** Data type */
  type: SlashOptionType;
  /** Is this option required? */
  required?: boolean;
  /** Predefined choices (mutually exclusive with autocomplete) */
  choices?: SlashOptionChoice[];
  /** Enable autocomplete for dynamic choices */
  autocomplete?: boolean;
  /** Min value for number/integer */
  minValue?: number;
  /** Max value for number/integer */
  maxValue?: number;
  /** Min length for string */
  minLength?: number;
  /** Max length for string */
  maxLength?: number;
  /** Channel types to show (for channel option) */
  channelTypes?: ('text' | 'voice' | 'category' | 'announcement' | 'thread')[];
}

/**
 * Subcommand definition
 */
export interface SlashSubcommand {
  /** Subcommand name */
  name: string;
  /** Description shown to users */
  description: string;
  /** Options for this subcommand */
  options?: SlashOption[];
}

/**
 * Subcommand group (for organizing related subcommands)
 */
export interface SlashSubcommandGroup {
  /** Group name */
  name: string;
  /** Description shown to users */
  description: string;
  /** Subcommands in this group */
  subcommands: SlashSubcommand[];
}

/**
 * Full slash command definition
 */
export interface SlashCommandDefinition {
  /** Command name (lowercase, no spaces, 1-32 chars) */
  name: string;
  /** Description shown to users (1-100 chars) */
  description: string;
  /**
   * Options for this command.
   * Mutually exclusive with subcommands/subcommandGroups
   */
  options?: SlashOption[];
  /**
   * Subcommands (e.g., /memory view, /memory add)
   * Mutually exclusive with options
   */
  subcommands?: SlashSubcommand[];
  /**
   * Subcommand groups (e.g., /memory admin view)
   * Mutually exclusive with options
   */
  subcommandGroups?: SlashSubcommandGroup[];
  /**
   * Default permission level required
   * 'everyone' = anyone can use
   * 'moderator' = requires Moderate Members (Discord) or Admin (Slack)
   * 'admin' = requires Administrator (Discord) or Owner (Slack)
   */
  defaultPermission?: 'everyone' | 'moderator' | 'admin';
  /** Only allow in DMs */
  dmOnly?: boolean;
  /** Only allow in guilds/workspaces */
  guildOnly?: boolean;
  /** Restrict to specific platforms */
  platforms?: Platform[];
}

/**
 * Registered command with metadata
 */
export interface RegisteredCommand extends SlashCommandDefinition {
  /** Plugin that registered this command */
  pluginId: string;
  /** When this command was registered */
  registeredAt: Date;
}

/**
 * Command registry for tracking all registered commands
 */
export interface CommandRegistry {
  /** Register a command */
  register(command: SlashCommandDefinition, pluginId: string): void;
  /** Unregister a command */
  unregister(commandName: string): void;
  /** Get all registered commands */
  getAll(): RegisteredCommand[];
  /** Get commands for a specific platform */
  getForPlatform(platform: Platform): RegisteredCommand[];
  /** Get a specific command */
  get(commandName: string): RegisteredCommand | undefined;
  /** Check if a command exists */
  has(commandName: string): boolean;
}
