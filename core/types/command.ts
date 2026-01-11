/**
 * Command types - platform agnostic slash commands
 */

import type { BotChannel, BotUser, Platform } from './message';

/**
 * Command option types (matches Discord/Slack capabilities)
 */
export type CommandOptionType = 'string' | 'number' | 'boolean' | 'user' | 'channel';

/**
 * Command option definition
 */
export interface CommandOption {
  name: string;
  description: string;
  type: CommandOptionType;
  required?: boolean;
  choices?: Array<{ name: string; value: string | number }>;
  autocomplete?: boolean;
}

/**
 * Command definition
 */
export interface BotCommand {
  name: string;
  description: string;
  options?: CommandOption[];
  subcommands?: BotCommand[];
}

/**
 * Command invocation (when user runs a command)
 */
export interface CommandInvocation {
  commandName: string;
  subcommand?: string;
  subcommandGroup?: string;
  args: Record<string, unknown>;
  user: BotUser;
  channel: BotChannel;
  guildId?: string;
  platform: Platform;
  /** Platform-specific interaction object for advanced use */
  raw?: unknown;
  /** Respond to this command */
  reply: (response: CommandResponse) => Promise<void>;
  /** Defer the response (for long-running commands) */
  defer: (ephemeral?: boolean) => Promise<void>;
  /** Follow up after deferring */
  followUp: (response: CommandResponse) => Promise<void>;
  /** Show a modal dialog */
  showModal: (modal: ModalDefinition) => Promise<void>;
}

/**
 * Modal definition for showModal
 */
export interface ModalDefinition {
  customId: string;
  title: string;
  fields: ModalField[];
}

export interface ModalField {
  customId: string;
  label: string;
  style: 'short' | 'paragraph';
  placeholder?: string;
  value?: string;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
}

/**
 * Command response
 */
export interface CommandResponse {
  content?: string;
  ephemeral?: boolean;
  attachments?: Array<{
    filename: string;
    data: Buffer | string;
  }>;
  embeds?: BotEmbed[];
  components?: BotComponent[][];
}

/**
 * Autocomplete request (when user is typing in an autocomplete field)
 */
export interface AutocompleteRequest {
  commandName: string;
  subcommand?: string;
  subcommandGroup?: string;
  /** The option that is being autocompleted */
  focusedOption: {
    name: string;
    value: string;
  };
  /** All current option values */
  options: Record<string, unknown>;
  user: BotUser;
  channel: BotChannel;
  guildId?: string;
  platform: Platform;
  raw?: unknown;
  /** Respond with autocomplete choices */
  respond: (choices: AutocompleteChoice[]) => Promise<void>;
}

/**
 * Autocomplete choice
 */
export interface AutocompleteChoice {
  name: string;
  value: string | number;
}

/**
 * Autocomplete response
 */
export interface AutocompleteResponse {
  choices: AutocompleteChoice[];
}

/**
 * Button interaction
 */
export interface ButtonInteraction {
  customId: string;
  user: BotUser;
  channel: BotChannel;
  messageId: string;
  guildId?: string;
  platform: Platform;
  raw?: unknown;
  /** Acknowledge and update the message */
  update: (response: CommandResponse) => Promise<void>;
  /** Acknowledge without updating */
  deferUpdate: () => Promise<void>;
  /** Reply with a new message */
  reply: (response: CommandResponse) => Promise<void>;
}

/**
 * Select menu interaction
 */
export interface SelectMenuInteraction {
  customId: string;
  values: string[];
  user: BotUser;
  channel: BotChannel;
  messageId: string;
  guildId?: string;
  platform: Platform;
  raw?: unknown;
  update: (response: CommandResponse) => Promise<void>;
  deferUpdate: () => Promise<void>;
  reply: (response: CommandResponse) => Promise<void>;
}

/**
 * Modal submit interaction
 */
export interface ModalSubmitInteraction {
  customId: string;
  /** Field values from the modal */
  fields: Record<string, string>;
  user: BotUser;
  channel: BotChannel;
  guildId?: string;
  platform: Platform;
  raw?: unknown;
  reply: (response: CommandResponse) => Promise<void>;
  defer: (ephemeral?: boolean) => Promise<void>;
}

/**
 * Embed structure (simplified, platform adapters expand as needed)
 */
export interface BotEmbed {
  title?: string;
  description?: string;
  color?: number;
  url?: string;
  timestamp?: Date;
  footer?: { text: string; iconUrl?: string };
  thumbnail?: { url: string };
  image?: { url: string };
  author?: { name: string; url?: string; iconUrl?: string };
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
}

/**
 * Interactive components (buttons, selects)
 */
export type BotComponent = BotButton | BotSelectMenu;

export interface BotButton {
  type: 'button';
  customId: string;
  label: string;
  style: 'primary' | 'secondary' | 'success' | 'danger' | 'link';
  url?: string; // For link buttons
  disabled?: boolean;
  emoji?: string;
}

export interface BotSelectMenu {
  type: 'select';
  customId: string;
  placeholder?: string;
  options: Array<{
    label: string;
    value: string;
    description?: string;
    emoji?: string;
    default?: boolean;
  }>;
  minValues?: number;
  maxValues?: number;
  disabled?: boolean;
}

/**
 * Shortcut invocation (Slack global/message shortcuts, could map to Discord context menus)
 */
export interface ShortcutInvocation {
  callbackId: string;
  type: 'global' | 'message';
  user: BotUser;
  channel?: BotChannel;
  /** For message shortcuts, the message that was acted upon */
  message?: {
    id: string;
    content: string;
    authorId: string;
  };
  /** Trigger ID for opening modals */
  triggerId: string;
  platform: Platform;
  raw?: unknown;
  /** Open a modal in response */
  openModal: (view: ModalViewDefinition) => Promise<void>;
  /** Send an acknowledgment */
  ack: () => Promise<void>;
}

/**
 * Options request (Slack external data source for select menus)
 * Similar to autocomplete but for select menus specifically
 */
export interface OptionsRequest {
  /** The action/block ID requesting options */
  actionId: string;
  /** Current search value (if user is typing) */
  value: string;
  user: BotUser;
  channel?: BotChannel;
  platform: Platform;
  raw?: unknown;
  /** Respond with options */
  respond: (options: SelectOption[]) => Promise<void>;
}

export interface SelectOption {
  label: string;
  value: string;
  description?: string;
}

/**
 * Modal view definition for opening modals
 */
export interface ModalViewDefinition {
  callbackId: string;
  title: string;
  submitLabel?: string;
  closeLabel?: string;
  /** Block Kit blocks (Slack) or components (Discord) - kept generic */
  blocks: ModalBlock[];
  /** Private metadata to pass through submission */
  privateMetadata?: string;
}

/**
 * Generic modal block (simplified - adapters expand to platform-specific format)
 */
export interface ModalBlock {
  type: 'input' | 'section' | 'divider' | 'header' | 'context';
  blockId?: string;
  /** For input blocks */
  element?: {
    type: 'text' | 'textarea' | 'select' | 'multi_select' | 'datepicker';
    actionId: string;
    placeholder?: string;
    options?: SelectOption[];
    initialValue?: string;
  };
  /** For section/header blocks */
  text?: string;
  label?: string;
  optional?: boolean;
}
