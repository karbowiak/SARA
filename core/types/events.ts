/**
 * Event type definitions for the EventBus
 */

import type {
  AutocompleteRequest,
  AutocompleteResponse,
  ButtonInteraction,
  CommandInvocation,
  CommandResponse,
  ModalSubmitInteraction,
  OptionsRequest,
  SelectMenuInteraction,
  ShortcutInvocation,
} from './command';
import type { BotMessage, BotReaction, DMSendRequest, MessageSendRequest, Platform } from './message';

/**
 * AI processing event payloads
 */
export interface AIProcessingStarted {
  messageId: string;
  userId: string;
  channelId: string;
  content: string;
  model: string;
}

export interface AIToolCall {
  messageId: string;
  toolName: string;
  toolCallId: string;
  arguments: Record<string, unknown>;
}

export interface AIToolResult {
  messageId: string;
  toolName: string;
  toolCallId: string;
  success: boolean;
  durationMs: number;
  result?: unknown;
  error?: string;
}

export interface AIResponseGenerated {
  messageId: string;
  content: string;
  model: string;
  toolsUsed: string[];
  totalDurationMs: number;
  promptTokens?: number;
  completionTokens?: number;
}

export interface AIError {
  messageId: string;
  error: string;
  phase: 'init' | 'embedding' | 'tool_call' | 'response' | 'send';
}

/**
 * All events the system can emit/handle
 *
 * This provides type safety for event names and payloads.
 * When you emit('message:received', msg), TypeScript ensures msg is a BotMessage.
 */
export interface EventMap {
  // Lifecycle events
  'bot:ready': { platform: Platform };
  'bot:shutdown': { reason?: string };
  'bot:error': { error: Error; context?: string };

  // Incoming message events (from platform adapters)
  'message:received': BotMessage;
  'message:updated': BotMessage;
  'message:deleted': { messageId: string; channelId: string; platform: Platform };

  // Slash command events
  'command:received': CommandInvocation;

  // Autocomplete/options events (Discord: autocomplete, Slack: options)
  'command:autocomplete': AutocompleteRequest;
  'options:request': OptionsRequest;

  // Shortcut events (Slack-specific, but abstracted)
  'shortcut:global': ShortcutInvocation;
  'shortcut:message': ShortcutInvocation;

  // Component interaction events (buttons, selects, modals)
  'interaction:button': ButtonInteraction;
  'interaction:select': SelectMenuInteraction;
  'interaction:modal': ModalSubmitInteraction;

  // Reaction events
  'reaction:added': BotReaction;
  'reaction:removed': BotReaction;

  // Outgoing events (to platform adapters)
  'message:send': MessageSendRequest;
  'message:fetch': MessageFetchRequest;
  'dm:send': DMSendRequest;
  'typing:start': TypingRequest;
  'typing:stop': TypingRequest;
  'command:respond': { invocation: CommandInvocation; response: CommandResponse };
  'autocomplete:respond': { request: AutocompleteRequest; response: AutocompleteResponse };
  'reaction:add': BotReaction;
  'reaction:remove': BotReaction;
  'modal:open': ModalOpenRequest;

  // AI processing events (for logging/monitoring)
  'ai:processing': AIProcessingStarted;
  'ai:tool_call': AIToolCall;
  'ai:tool_result': AIToolResult;
  'ai:response': AIResponseGenerated;
  'ai:error': AIError;

  // Internal events
  'plugin:loaded': { pluginId: string };
  'plugin:unloaded': { pluginId: string };
  'plugin:error': { pluginId: string; error: Error };
}

/**
 * Request to open a modal (triggered by shortcut, button, etc.)
 */
export interface ModalOpenRequest {
  triggerId: string;
  view: ModalView;
  platform: Platform;
}

/**
 * Request to show/hide typing indicator
 */
export interface TypingRequest {
  channelId: string;
  platform: Platform;
}

/**
 * Request to fetch a message from the platform
 */
export interface MessageFetchRequest {
  channelId: string;
  messageId: string;
  platform: Platform;
  /** Callback with the fetched message content (null if not found) */
  callback: (content: string | null) => void;
}

/**
 * Modal view definition
 */
export interface ModalView {
  callbackId: string;
  title: string;
  submitLabel?: string;
  closeLabel?: string;
  blocks: unknown[]; // Platform-specific block definitions
}

/**
 * Event names (for type safety)
 */
export type EventName = keyof EventMap;

/**
 * Get payload type for an event
 */
export type EventPayload<E extends EventName> = EventMap[E];

/**
 * Event handler function type
 */
export type EventHandler<E extends EventName> = (payload: EventPayload<E>) => void | Promise<void>;
