/**
 * LLM Client - Generic interface for Large Language Model APIs
 *
 * Supports OpenAI-compatible APIs like OpenRouter, Together, Groq, etc.
 */

import { fetcher } from './helpers/fetcher';
import type { Tool } from './types';

/**
 * Chat message role
 */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/**
 * Chat message
 */
export interface ContentPartText {
  type: 'text';
  text: string;
}

export interface ContentPartImageUrl {
  type: 'image_url';
  image_url: { url: string };
}

export type ContentPart = ContentPartText | ContentPartImageUrl;

export interface ChatMessage {
  role: MessageRole;
  content: string | ContentPart[] | null;
  name?: string;
  /** Tool call ID (for tool responses) */
  tool_call_id?: string;
  /** Tool calls made by assistant */
  tool_calls?: ToolCall[];
}

/**
 * Tool call from assistant
 */
export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

/**
 * Chat completion request
 */
export interface ChatCompletionRequest {
  /** Messages in the conversation */
  messages: ChatMessage[];
  /** Model to use */
  model: string;
  /** Tools available to the model */
  tools?: ToolDefinition[];
  /** Temperature (0-2) */
  temperature?: number;
  /** Max tokens to generate */
  max_tokens?: number;
  /** Stop sequences */
  stop?: string[];
  /** Whether to stream the response */
  stream?: boolean;
}

/**
 * Tool definition for the API
 */
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    strict?: boolean;
  };
}

/**
 * Chat completion response
 */
export interface ChatCompletionResponse {
  id: string;
  model: string;
  choices: ChatCompletionChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Chat completion choice
 */
export interface ChatCompletionChoice {
  index: number;
  message: ChatMessage;
  finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
}

/**
 * LLM Client configuration
 */
export interface LLMClientConfig {
  /** API key */
  apiKey: string;
  /** Base URL for the API */
  baseUrl?: string;
  /** Default model to use */
  defaultModel?: string;
  /** Default temperature */
  defaultTemperature?: number;
  /** Default max tokens */
  defaultMaxTokens?: number;
  /** Request timeout in ms */
  timeout?: number;
  /** Custom headers */
  headers?: Record<string, string>;
}

/**
 * LLM Client - Generic client for OpenAI-compatible APIs
 */
export class LLMClient {
  private config: Required<Omit<LLMClientConfig, 'headers'>> & { headers: Record<string, string> };

  constructor(config: LLMClientConfig) {
    this.config = {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl ?? 'https://openrouter.ai/api/v1',
      defaultModel: config.defaultModel ?? 'anthropic/claude-3.5-sonnet',
      defaultTemperature: config.defaultTemperature ?? 0.7,
      defaultMaxTokens: config.defaultMaxTokens ?? 4096,
      timeout: config.timeout ?? 120000,
      headers: config.headers ?? {},
    };
  }

  /**
   * Create a chat completion
   */
  async chat(request: Partial<ChatCompletionRequest> & { messages: ChatMessage[] }): Promise<ChatCompletionResponse> {
    const fullRequest: ChatCompletionRequest = {
      model: request.model ?? this.config.defaultModel,
      messages: request.messages,
      temperature: request.temperature ?? this.config.defaultTemperature,
      max_tokens: request.max_tokens ?? this.config.defaultMaxTokens,
      tools: request.tools,
      stop: request.stop,
      stream: false,
    };

    const response = await fetcher(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
        ...this.config.headers,
      },
      body: JSON.stringify(fullRequest),
      timeout: this.config.timeout,
      retries: 3,
      retryDelay: 1000,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`LLM API error (${response.status}): ${error}`);
    }

    return (await response.json()) as ChatCompletionResponse;
  }

  /**
   * Simple completion helper - sends a single message and returns the response text
   */
  async complete(
    prompt: string,
    options?: {
      system?: string;
      model?: string;
      temperature?: number;
    },
  ): Promise<string> {
    const messages: ChatMessage[] = [];

    if (options?.system) {
      messages.push({ role: 'system', content: options.system });
    }
    messages.push({ role: 'user', content: prompt });

    const response = await this.chat({
      messages,
      model: options?.model,
      temperature: options?.temperature,
    });

    const content = response.choices[0]?.message.content;
    if (!content) return '';

    // Convert to string if it's a multimodal array
    return Array.isArray(content) ? content.map((p) => (p.type === 'text' ? p.text : '[image]')).join(' ') : content;
  }

  /**
   * Convert Tool[] to ToolDefinition[] for the API
   */
  static toolsToDefinitions(tools: Tool[]): ToolDefinition[] {
    return tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.schema.name,
        description: tool.schema.description,
        parameters: tool.schema.parameters as unknown as Record<string, unknown>,
        strict: tool.schema.strict,
      },
    }));
  }
}

/**
 * Create an LLM client with OpenRouter defaults
 */
export function createOpenRouterClient(apiKey: string, options?: Partial<LLMClientConfig>): LLMClient {
  return new LLMClient({
    apiKey,
    baseUrl: options?.baseUrl ?? 'https://openrouter.ai/api/v1',
    defaultModel: 'anthropic/claude-3.5-sonnet',
    headers: {
      'HTTP-Referer': 'https://github.com/your-bot', // Required by OpenRouter
      'X-Title': 'Bot', // Optional, shows in OpenRouter dashboard
      ...options?.headers,
    },
    ...options,
  });
}

/**
 * Create an LLM client with OpenAI defaults
 */
export function createOpenAIClient(apiKey: string, options?: Partial<LLMClientConfig>): LLMClient {
  return new LLMClient({
    apiKey,
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
    ...options,
  });
}
