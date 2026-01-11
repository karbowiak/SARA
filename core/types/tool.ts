/**
 * AI Tool Types - Interfaces for AI function calling tools
 *
 * Platform-agnostic tool definitions compatible with OpenAI function calling,
 * Anthropic tool use, and other LLM APIs.
 */

import type { EventBus } from '../event-bus';
import type { BotChannel, BotMessage, BotUser } from './message';
import type { Logger } from './plugin';

/**
 * Tool category for organization and filtering
 */
export type ToolCategory = 'creative' | 'information' | 'utility' | 'admin' | 'general';

/**
 * Tool metadata - describes the tool for registration and selection
 */
export interface ToolMetadata {
  /** Unique tool identifier (matches schema.name) */
  name: string;

  /** Human-readable description */
  description: string;

  /** Tool version */
  version: string;

  /** Tool author/maintainer */
  author: string;

  /** Keywords that suggest this tool should be used */
  keywords: string[];

  /** Category for organization */
  category: ToolCategory;

  /** Priority (higher = more likely to be selected when keywords match) */
  priority: number;
}

/**
 * OpenAI-compatible function calling schema
 *
 * This format is widely supported across LLM providers.
 */
export interface ToolSchema {
  /** Always 'function' */
  type: 'function';

  /** Function name (must match metadata.name) */
  name: string;

  /** Description for AI to understand when to use tool */
  description: string;

  /** JSON Schema for parameters */
  parameters: JsonSchema;

  /** Whether to enforce strict parameter validation */
  strict?: boolean;
}

/**
 * JSON Schema definition (subset for tool parameters)
 */
export interface JsonSchema {
  type: 'object';
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

/**
 * JSON Schema property definition
 */
export interface JsonSchemaProperty {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  description?: string;
  enum?: (string | number | boolean)[];
  items?: JsonSchemaProperty;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  default?: unknown;
}

/**
 * Context provided to tool execution
 *
 * Platform-agnostic - contains normalized message/user/channel.
 */
export interface ToolExecutionContext {
  /** Message that triggered tool usage */
  message: BotMessage;

  /** User who invoked the tool */
  user: BotUser;

  /** Channel where tool was invoked */
  channel: BotChannel;

  /** Logger for structured logging */
  logger: Logger;

  /** Event bus for sending messages/reactions */
  eventBus: EventBus;

  /** Access to other services if needed */
  getService?<T>(name: string): T | undefined;
}

/**
 * Result of tool execution
 */
export interface ToolResult {
  /** Whether tool execution succeeded */
  success: boolean;

  /** Result data (sent back to AI) */
  data?: unknown;

  /** User-facing message (optional - can be displayed directly) */
  message?: string;

  /** Error details if success=false */
  error?: ToolError;
}

/**
 * Tool error details
 */
export interface ToolError {
  /** Error type/code */
  type: string;

  /** Error message */
  message: string;

  /** Whether the error is retryable */
  retryable?: boolean;
}

/**
 * AI Tool interface - custom function tools
 *
 * Implement this interface to create tools the AI can call.
 */
export interface Tool {
  /** Tool metadata for registration and selection */
  readonly metadata: ToolMetadata;

  /** OpenAI-compatible function schema */
  readonly schema: ToolSchema;

  /**
   * Execute the tool with parsed arguments
   * @param args - Arguments parsed according to schema
   * @param context - Execution context with message, user, etc.
   */
  execute(args: unknown, context: ToolExecutionContext): Promise<ToolResult>;

  /**
   * Validate tool is ready to use (optional)
   * @returns true if tool is properly configured
   */
  validate?(): boolean;
}

// ============================================
// Built-in Tool Support (OpenAI specific)
// ============================================

/**
 * Built-in OpenAI tool types
 */
export type BuiltInToolType = 'web_search_preview' | 'image_generation' | 'code_interpreter' | 'file_search';

/**
 * Built-in tool configuration (for OpenAI native tools)
 */
export interface BuiltInTool {
  /** Tool type identifier */
  type: BuiltInToolType;

  /** Tool metadata for registry */
  metadata: ToolMetadata;

  /** Additional configuration (varies by tool type) */
  config?: Record<string, unknown>;
}

// ============================================
// Tool Registration
// ============================================

/**
 * Tool registration with selection hints
 */
export interface ToolRegistration {
  /** The tool instance */
  tool: Tool | BuiltInTool;

  /** Keywords for contextual selection */
  keywords: string[];

  /** Category for filtering */
  category: ToolCategory;

  /** Selection priority */
  priority: number;

  /** Whether tool is enabled */
  enabled: boolean;
}

/**
 * Tool selection configuration
 */
export interface ToolSelectionConfig {
  /** Selection strategy */
  strategy: 'all' | 'contextual' | 'categories';

  /** Maximum tools per request */
  maxToolsPerRequest: number;

  /** Enable keyword-based selection */
  enableKeywordMatching: boolean;

  /** Enable category filtering */
  enableCategoryFiltering: boolean;
}

// ============================================
// Type Guards
// ============================================

/**
 * Type guard for custom Tool
 */
export function isTool(obj: unknown): obj is Tool {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    'metadata' in obj &&
    'schema' in obj &&
    'execute' in obj &&
    typeof (obj as Tool).execute === 'function'
  );
}

/**
 * Type guard for BuiltInTool
 */
export function isBuiltInTool(obj: unknown): obj is BuiltInTool {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    'type' in obj &&
    typeof (obj as BuiltInTool).type === 'string' &&
    'metadata' in obj &&
    !('execute' in obj)
  );
}

// ============================================
// Helper: Create Tool Schema
// ============================================

/**
 * Helper to create a properly typed tool schema
 */
export function createToolSchema(
  name: string,
  description: string,
  properties: Record<string, JsonSchemaProperty>,
  required: string[] = [],
  strict = false,
): ToolSchema {
  return {
    type: 'function',
    name,
    description,
    parameters: {
      type: 'object',
      properties,
      required,
      additionalProperties: false,
    },
    strict,
  };
}
