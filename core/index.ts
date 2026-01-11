/**
 * Core framework exports
 *
 * Import as: import { EventBus, Command } from "@core"
 */

// CLI
export { Command, type CommandConstructor } from './cli/command';
export { COLORS, ConsoleIO, color } from './cli/console-io';
export { Runner, type RunnerOptions, runCli } from './cli/runner';
export { generateHelp, parseSignature } from './cli/signature';
// Command Registry (for slash commands)
export {
  getCommandRegistry,
  registerCommand,
  unregisterCommand,
} from './command-registry';

// Config
export {
  type AIBehaviorConfig,
  type BotConfig,
  type BotIdentityConfig,
  buildSimplePrompt,
  buildSystemPrompt,
  getBotConfig,
  loadBotConfig,
  type PersonalityConfig,
  type PromptContext,
} from './config';
// EventBus
export { createEventBus, EventBus, type EventBusOptions } from './event-bus';
// LLM Client
export {
  type ChatCompletionRequest,
  type ChatCompletionResponse,
  type ChatMessage,
  createOpenAIClient,
  createOpenRouterClient,
  LLMClient,
  type LLMClientConfig,
  type MessageRole,
  type ToolCall,
  type ToolDefinition,
} from './llm-client';
// Plugin Loader
export {
  type LoadedPlugins,
  loadPlugins,
  type PluginLoaderOptions,
  shouldHandlerProcess,
  unloadPlugins,
} from './plugin-loader';
// Tool Loader
export {
  getToolByName,
  loadTools,
  type ToolLoaderOptions,
} from './tool-loader';

// Types
export * from './types';
