/**
 * Plugin Types - Core plugin system interfaces
 *
 * Platform-agnostic plugin definitions that work across Discord, Slack, etc.
 */

import type { EventBus } from '../event-bus';
import type { CommandInvocation } from './command';
import type { BotMessage, Platform } from './message';

/**
 * Logger interface for plugins
 */
export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

/**
 * Plugin type categories
 */
export type PluginType = 'message' | 'command' | 'timer' | 'tool';

/**
 * Base plugin interface that all plugins must implement
 */
export interface Plugin {
  /** Unique plugin identifier */
  readonly id: string;

  /** Plugin type for categorization */
  readonly type: PluginType;

  /**
   * Priority for execution order (higher = runs first)
   * Default: 0, Logger uses 100 to run first
   */
  readonly priority?: number;

  /** Initialize plugin with context */
  load(context: PluginContext): void | Promise<void>;

  /** Cleanup when plugin is unloaded */
  unload(): void | Promise<void>;
}

/**
 * Runtime context provided to plugins during load()
 */
export interface PluginContext {
  /** EventBus for pub/sub communication */
  readonly eventBus: EventBus;

  /** Structured logger */
  readonly logger: Logger;

  /** Plugin-specific configuration */
  readonly config?: PluginConfig;

  /** Get a service by name (for dependency injection) */
  getService?<T>(name: string): T | undefined;
}

/**
 * Plugin configuration structure
 */
export interface PluginConfig {
  /** Plugin identifier this config belongs to */
  pluginId: string;

  /** Whether plugin is enabled */
  enabled: boolean;

  /** Guild/workspace-specific enablement (optional) */
  scopeId?: string;

  /** Custom settings */
  settings?: Record<string, unknown>;
}

/**
 * Plugin metadata tracked by PluginManager
 */
export interface PluginMetadata {
  /** The plugin instance */
  plugin: Plugin;

  /** When plugin was loaded */
  loadedAt: Date;

  /** Whether plugin is currently active */
  isActive: boolean;

  /** Number of times plugin handled an event */
  invocationCount: number;

  /** Number of errors encountered */
  errorCount: number;

  /** Last successful invocation */
  lastInvokedAt?: Date;

  /** Last error timestamp */
  lastErrorAt?: Date;
}

/**
 * Plugin error information
 */
export interface PluginError {
  /** Plugin that errored */
  pluginId: string;

  /** Event being handled when error occurred */
  event: string;

  /** The error */
  error: Error;

  /** When the error occurred */
  timestamp: Date;

  /** Additional context */
  context?: Record<string, unknown>;
}

// ============================================
// Specialized Plugin Interfaces
// ============================================

/**
 * Message handler trigger scope
 * - 'mention': Only trigger when bot is mentioned/highlighted (default)
 * - 'all': Trigger on all messages (useful for link handlers, etc.)
 */
export type MessageHandlerScope = 'mention' | 'all';

/**
 * Message handler plugin - reacts to chat messages
 */
export interface MessageHandlerPlugin extends Plugin {
  readonly type: 'message';

  /**
   * When to trigger this handler
   * - 'mention': Only when bot is mentioned (default)
   * - 'all': On all messages
   */
  readonly scope?: MessageHandlerScope;

  /**
   * Restrict to specific platforms (e.g., ['discord', 'slack'])
   * If undefined, works on all platforms
   */
  readonly platforms?: readonly Platform[];

  /**
   * Restrict to specific guild/server IDs
   * If undefined, works in all guilds
   */
  readonly guildIds?: readonly string[];

  /**
   * Check if this handler should process the message
   * (e.g., keyword matching, regex, always)
   * Note: This is called AFTER scope/platform/guild filtering
   */
  shouldHandle(message: BotMessage): boolean | Promise<boolean>;

  /**
   * Handle the message
   */
  handle(message: BotMessage, context: PluginContext): void | Promise<void>;
}

/**
 * Command handler plugin - handles slash commands
 *
 * Commands can either implement handle() directly or use the event bus
 * pattern by subscribing to 'command:received' events in load().
 */
export interface CommandHandlerPlugin extends Plugin {
  readonly type: 'command';

  /** Command name(s) this handler responds to */
  readonly commands: string[];

  /**
   * Handle command invocation (optional if using event bus pattern)
   */
  handle?(invocation: CommandInvocation, context: PluginContext): void | Promise<void>;
}

/**
 * Timer configuration
 */
export interface TimerConfig {
  /** Timer interval in milliseconds */
  intervalMs: number;

  /** Whether timer should run immediately on load */
  runImmediately?: boolean;

  /** Maximum concurrent executions (default: 1) */
  maxConcurrent?: number;
}

/**
 * Timer handler plugin - runs on schedule
 */
export interface TimerHandlerPlugin extends Plugin {
  readonly type: 'timer';

  /** Timer configuration */
  readonly timerConfig: TimerConfig;

  /**
   * Execute timer task
   */
  tick(context: PluginContext): void | Promise<void>;
}

// ============================================
// Type Guards
// ============================================

/**
 * Type guard to check if an object is a valid Plugin
 */
export function isPlugin(obj: unknown): obj is Plugin {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    'id' in obj &&
    typeof (obj as Plugin).id === 'string' &&
    'type' in obj &&
    typeof (obj as Plugin).type === 'string' &&
    'load' in obj &&
    typeof (obj as Plugin).load === 'function' &&
    'unload' in obj &&
    typeof (obj as Plugin).unload === 'function'
  );
}

/**
 * Type guard for MessageHandlerPlugin
 */
export function isMessageHandler(plugin: Plugin): plugin is MessageHandlerPlugin {
  return (
    plugin.type === 'message' &&
    'shouldHandle' in plugin &&
    typeof (plugin as MessageHandlerPlugin).shouldHandle === 'function' &&
    'handle' in plugin &&
    typeof (plugin as MessageHandlerPlugin).handle === 'function'
  );
}

/**
 * Type guard for CommandHandlerPlugin
 */
export function isCommandHandler(plugin: Plugin): plugin is CommandHandlerPlugin {
  return (
    plugin.type === 'command' &&
    'commands' in plugin &&
    Array.isArray((plugin as CommandHandlerPlugin).commands) &&
    'handle' in plugin &&
    typeof (plugin as CommandHandlerPlugin).handle === 'function'
  );
}

/**
 * Type guard for TimerHandlerPlugin
 */
export function isTimerHandler(plugin: Plugin): plugin is TimerHandlerPlugin {
  return (
    plugin.type === 'timer' &&
    'timerConfig' in plugin &&
    'tick' in plugin &&
    typeof (plugin as TimerHandlerPlugin).tick === 'function'
  );
}
