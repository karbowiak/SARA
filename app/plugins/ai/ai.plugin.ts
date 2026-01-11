/**
 * AI Plugin - Handles AI-powered conversations
 *
 * This plugin responds to @mentions and uses AI to generate responses.
 * Supports text and image understanding via configurable models on OpenRouter.
 */

import {
  type AccessContext,
  type BotConfig,
  type BotMessage,
  buildSystemPrompt,
  type ChatMessage,
  createOpenRouterClient,
  getAccessibleTools,
  getBotConfig,
  LLMClient,
  type LoadedTools,
  loadTools,
  type MessageHandlerPlugin,
  type PluginContext,
  type Tool,
  type ToolCall,
  type ToolExecutionContext,
} from '@core';
import {
  formatMemoriesForPrompt,
  getMemoriesForPrompt,
  getRecentMessages,
  getUserByPlatformId,
  type SimilarMessage,
  searchSimilar,
} from '@core/database';
import path from 'path';
import { embed, isEmbedderReady } from '../../../core/embedder';

/** Fallback model if not configured */
const FALLBACK_MODEL = 'x-ai/grok-4.1-fast';

/** Number of recent messages to include in conversation history */
const HISTORY_LIMIT = 20;

/** Number of semantic search results to include */
const SEMANTIC_LIMIT = 5;

/** Minimum similarity score to include in semantic results */
const SEMANTIC_THRESHOLD = 0.3;

export class AIPlugin implements MessageHandlerPlugin {
  readonly id = 'ai';
  readonly type = 'message' as const;
  // Only respond when mentioned (default behavior)

  private context?: PluginContext;
  private loadedTools: LoadedTools = { all: [], accessConfig: new Map() };
  private llm?: LLMClient;
  private config?: BotConfig;
  private model: string = FALLBACK_MODEL;

  async load(context: PluginContext): Promise<void> {
    this.context = context;

    // Load bot configuration (should already be loaded by discord command)
    this.config = getBotConfig();
    this.model = this.config.ai?.defaultModel ?? FALLBACK_MODEL;

    // Initialize LLM client with API key from config
    const apiKey = this.config.tokens.openrouter;
    if (!apiKey) {
      context.logger.warn('OpenRouter API key not set in config - AI plugin will not work');
      return;
    }

    this.llm = createOpenRouterClient(apiKey, {
      defaultModel: this.model,
      defaultTemperature: this.config.ai?.temperature,
      defaultMaxTokens: this.config.ai?.maxTokens,
      headers: {
        'HTTP-Referer': 'https://github.com/bot',
        'X-Title': this.config.bot.name,
      },
    });

    // Load tools from the tools directory (filtered by config)
    const toolsDir = path.join(import.meta.dir, 'tools');
    this.loadedTools = await loadTools({
      toolsDir,
      logger: context.logger,
      config: this.config,
    });

    context.logger.info('AIPlugin loaded', {
      model: this.model,
      botName: this.config.bot.name,
      tools: this.loadedTools.all.map((t) => t.metadata.name),
    });
  }

  async unload(): Promise<void> {
    this.context?.logger.info('AIPlugin unloaded');
    this.context = undefined;
    this.loadedTools = { all: [], accessConfig: new Map() };
    this.llm = undefined;
    this.config = undefined;
  }

  shouldHandle(message: BotMessage): boolean {
    // Don't respond to bots
    if (message.author.isBot) return false;

    // Always handle when mentioned (scope filtering already done)
    return true;
  }

  async handle(message: BotMessage, context: PluginContext): Promise<void> {
    const startTime = Date.now();
    const toolsUsed: string[] = [];

    if (!this.llm) {
      context.logger.error('LLM client not initialized');
      return;
    }

    // Emit processing started event
    context.eventBus.fire('ai:processing', {
      messageId: message.id,
      userId: message.author.id,
      channelId: message.channel.id,
      content: message.content.substring(0, 200),
      model: this.model,
    });

    context.logger.info('AI processing started', {
      messageId: message.id,
      author: message.author.name,
      contentLength: message.content.length,
      hasImages: message.attachments.some((a) => a.contentType?.startsWith('image/')),
    });

    // Start typing indicator
    context.eventBus.fire('typing:start', {
      channelId: message.channel.id,
      platform: message.platform,
    });

    try {
      // Get tools accessible to this user
      const accessibleTools = this.getToolsForUser(message);

      // Build messages for the API (includes history)
      const messages = await this.buildMessages(message, accessibleTools, context);

      // Get available tools
      const toolDefinitions = accessibleTools.length > 0 ? LLMClient.toolsToDefinitions(accessibleTools) : undefined;

      context.logger.debug('Calling LLM', {
        messageCount: messages.length,
        toolCount: toolDefinitions?.length ?? 0,
      });

      // Call the LLM
      const response = await this.llm.chat({
        messages,
        tools: toolDefinitions,
      });

      const choice = response.choices[0];
      if (!choice) {
        context.eventBus.fire('ai:error', {
          messageId: message.id,
          error: 'No response from LLM',
          phase: 'response',
        });
        context.logger.error('No response from LLM');
        return;
      }

      // Handle tool calls if present
      if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
        const result = await this.handleToolCalls(
          message,
          choice.message.tool_calls,
          messages,
          accessibleTools,
          context,
        );
        toolsUsed.push(...result.toolsUsed);

        // Emit response event
        context.eventBus.fire('ai:response', {
          messageId: message.id,
          content: result.content?.substring(0, 200) ?? '',
          model: this.model,
          toolsUsed,
          totalDurationMs: Date.now() - startTime,
          promptTokens: response.usage?.prompt_tokens,
          completionTokens: response.usage?.completion_tokens,
        });
        return;
      }

      // Send the response
      const content = choice.message.content;
      if (content) {
        await this.sendResponse(message, content, context);

        // Emit response event
        context.eventBus.fire('ai:response', {
          messageId: message.id,
          content: content.substring(0, 200),
          model: this.model,
          toolsUsed: [],
          totalDurationMs: Date.now() - startTime,
          promptTokens: response.usage?.prompt_tokens,
          completionTokens: response.usage?.completion_tokens,
        });
      }

      context.logger.info('AI response sent', {
        messageId: message.id,
        durationMs: Date.now() - startTime,
        toolsUsed,
        responseLength: content?.length ?? 0,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      context.eventBus.fire('ai:error', {
        messageId: message.id,
        error: errorMessage,
        phase: 'response',
      });

      context.logger.error('AI processing failed', {
        messageId: message.id,
        error: errorMessage,
        durationMs: Date.now() - startTime,
      });

      await this.sendResponse(message, '❌ Sorry, I encountered an error processing your request.', context);
    } finally {
      // Always stop typing indicator
      context.eventBus.fire('typing:stop', {
        channelId: message.channel.id,
        platform: message.platform,
      });
    }
  }

  /**
   * Get tools accessible to the user based on their roles
   */
  private getToolsForUser(message: BotMessage): Tool[] {
    const config = this.config ?? getBotConfig();

    // If no access control configured, return all loaded tools
    if (!config.accessGroups || !config.tools) {
      return this.loadedTools.all;
    }

    // Build access context from message
    const accessContext: AccessContext = {
      platform: message.platform,
      roleIds: message.author.roleIds,
      userId: message.author.id,
    };

    // Filter tools by access
    return getAccessibleTools(config, this.loadedTools.all, accessContext);
  }

  /**
   * Build chat messages from the incoming message
   *
   * Structure:
   * 1. System prompt with config, memories, and semantic search results
   * 2. Single user message containing:
   *    - Channel context (last N messages for reference)
   *    - Current user's message
   *
   * NOTE: We do NOT add history as separate user/assistant turns.
   * That confuses the model into thinking it already had a multi-turn conversation.
   * Instead, channel context is provided inline for reference.
   */
  private async buildMessages(message: BotMessage, tools: Tool[], context: PluginContext): Promise<ChatMessage[]> {
    const config = this.config ?? getBotConfig();
    const additionalContextParts: string[] = [];

    // Get user memories if we have a guild context
    if (message.guildId) {
      try {
        const user = getUserByPlatformId(message.platform, message.author.id);
        if (user) {
          const memories = await getMemoriesForPrompt({
            userId: user.id,
            guildId: message.guildId,
            currentMessage: message.content,
            limit: 10,
          });

          if (memories.length > 0) {
            const userName = message.author.displayName ?? message.author.name;
            const memoryContext = formatMemoriesForPrompt(memories, userName);
            additionalContextParts.push(memoryContext);
            context.logger.debug('Loaded user memories', {
              userId: user.id,
              memoriesCount: memories.length,
            });
          }
        }
      } catch (error) {
        context.logger.error('Failed to load user memories', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Get semantic search results for relevant older messages
    if (isEmbedderReady() && message.content.length >= 10) {
      try {
        const embedStartTime = Date.now();
        const queryEmbedding = await embed(message.content);
        const similar = searchSimilar({
          embedding: queryEmbedding,
          channelId: message.channel.id,
          limit: SEMANTIC_LIMIT,
          decayFactor: 0.98,
          includeBot: false,
        });

        // Filter by threshold only - don't exclude recent messages
        const relevantResults = similar.filter((s) => s.score >= SEMANTIC_THRESHOLD);

        if (relevantResults.length > 0) {
          additionalContextParts.push(this.formatSemanticResults(relevantResults));
          context.logger.debug('Semantic search completed', {
            query: message.content.substring(0, 50),
            resultsFound: relevantResults.length,
            topScore: relevantResults[0]?.score.toFixed(3),
            durationMs: Date.now() - embedStartTime,
          });
        }
      } catch (error) {
        context.logger.error('Semantic search failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Build system prompt with all context
    const systemPrompt = buildSystemPrompt(config, {
      platform: message.platform,
      tools: tools.length > 0 ? tools : undefined,
      additionalContext: additionalContextParts.length > 0 ? additionalContextParts.join('\n\n') : undefined,
    });

    const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt }];

    // Build user message with channel context inline
    const userContent = this.buildUserContentWithContext(message);
    messages.push({ role: 'user', content: userContent });

    return messages;
  }

  /**
   * Build user message content with channel context included inline
   *
   * Format:
   * [Channel Context - Recent messages]
   * @User1: message...
   * @Bot: response...
   * @User2: message...
   *
   * [Current Message]
   * @CurrentUser: actual message content
   */
  private buildUserContentWithContext(message: BotMessage): string {
    const parts: string[] = [];

    // Get channel context (recent messages)
    const channelContext = this.buildChannelContext(message);
    if (channelContext) {
      parts.push(`[Channel Context - Recent messages for reference]\n${channelContext}`);
    }

    // Build current message content
    const currentMessage = this.buildUserContent(message);
    parts.push(`[Current Message]\n${currentMessage}`);

    return parts.join('\n\n');
  }

  /**
   * Build channel context from recent messages (formatted as text, not separate turns)
   */
  private buildChannelContext(currentMessage: BotMessage): string {
    try {
      // Get recent messages from database (excluding current message)
      const recentMessages = getRecentMessages(currentMessage.channel.id, HISTORY_LIMIT + 1);

      // Filter out the current message and reverse to chronological order
      const history = recentMessages
        .filter((m) => m.platform_message_id !== currentMessage.id)
        .slice(0, HISTORY_LIMIT)
        .reverse();

      if (history.length === 0) return '';

      // Format as text context (not separate API messages)
      const lines = history.map((msg) => {
        const isBot = Boolean(msg.is_bot);
        const userName = isBot ? (this.config?.bot.name ?? 'Bot') : (msg.display_name ?? msg.username ?? 'Unknown');
        // created_at is Unix timestamp in milliseconds
        const timestamp = new Date(msg.created_at).toISOString().substring(11, 16); // HH:MM
        return `[${timestamp}] @${userName}: ${msg.content}`;
      });

      return lines.join('\n');
    } catch (error) {
      console.error('[AIPlugin] Channel context fetch error:', error);
      return '';
    }
  }

  /**
   * Format semantic search results for injection into system prompt
   */
  private formatSemanticResults(results: SimilarMessage[]): string {
    const lines = results.map((r) => {
      const age = this.formatAge(r.timestamp);
      return `- [${age}] @${r.userName}: "${r.content.substring(0, 150)}${r.content.length > 150 ? '...' : ''}"`;
    });

    return `# Relevant Past Messages
The following older messages may be relevant to this conversation:
${lines.join('\n')}`;
  }

  /**
   * Format timestamp as human-readable age
   */
  private formatAge(timestamp: number): string {
    const age = Date.now() - timestamp;
    const minutes = Math.floor(age / 60000);
    const hours = Math.floor(age / 3600000);
    const days = Math.floor(age / 86400000);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'just now';
  }

  /**
   * Build user message content, including images if present
   * Converts platform-specific mentions to readable @name format
   * Prefixes message with @author for context
   */
  private buildUserContent(message: BotMessage): string {
    // Convert mentions to readable format: <@123> → @username
    let content = message.content;

    // Build a map of user IDs to names from mentioned users
    const userMap = new Map<string, string>();
    for (const user of message.mentionedUsers) {
      userMap.set(user.id, user.displayName ?? user.name);
    }
    // Also include the author
    userMap.set(message.author.id, message.author.displayName ?? message.author.name);

    // Replace Discord-style mentions with @name
    content = content.replace(/<@!?(\d+)>/g, (match, userId) => {
      const name = userMap.get(userId);
      return name ? `@${name}` : match;
    });

    // Remove bot self-mentions dynamically using config
    const botName = this.config?.bot.name ?? 'Bot';
    const botNamePattern = new RegExp(`@(${botName}|Bot)\\b`, 'gi');
    content = content.replace(botNamePattern, '').trim();

    // If there are images, append their URLs for vision models
    const images = message.attachments.filter(
      (a) => a.contentType?.startsWith('image/') || /\.(png|jpg|jpeg|gif|webp)$/i.test(a.filename),
    );

    if (images.length > 0) {
      // For models that support vision, we include image URLs
      const imageUrls = images.map((img) => img.url).join('\n');
      content = `${content}\n\n[Images attached]:\n${imageUrls}`;
    }

    // Prefix with @author so the AI knows who is talking
    const authorName = message.author.displayName ?? message.author.name;
    return `@${authorName}: ${content || 'Hello!'}`;
  }

  /**
   * Handle tool calls from the LLM
   * Returns the tools used and final response content
   */
  private async handleToolCalls(
    message: BotMessage,
    toolCalls: ToolCall[],
    messages: ChatMessage[],
    accessibleTools: Tool[],
    context: PluginContext,
  ): Promise<{ toolsUsed: string[]; content: string | null }> {
    if (!this.llm) return { toolsUsed: [], content: null };

    const toolsUsed: string[] = [];

    // Add assistant message with tool calls
    messages.push({
      role: 'assistant',
      content: null,
      tool_calls: toolCalls,
    });

    context.logger.info('Processing tool calls', {
      messageId: message.id,
      toolCount: toolCalls.length,
      tools: toolCalls.map((tc) => tc.function.name),
    });

    // Execute each tool call
    for (const toolCall of toolCalls) {
      const toolName = toolCall.function.name;
      const tool = accessibleTools.find((t) => t.schema.name === toolName);

      // Emit tool call event
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(toolCall.function.arguments);
      } catch {
        args = { _raw: toolCall.function.arguments };
      }

      context.eventBus.fire('ai:tool_call', {
        messageId: message.id,
        toolName,
        toolCallId: toolCall.id,
        arguments: args,
      });

      if (!tool) {
        context.logger.warn('Tool not found', { toolName });

        context.eventBus.fire('ai:tool_result', {
          messageId: message.id,
          toolName,
          toolCallId: toolCall.id,
          success: false,
          durationMs: 0,
          error: `Tool ${toolName} not found`,
        });

        messages.push({
          role: 'tool',
          content: JSON.stringify({ error: `Tool ${toolName} not found` }),
          tool_call_id: toolCall.id,
        });
        continue;
      }

      toolsUsed.push(toolName);
      const toolStartTime = Date.now();

      try {
        const execContext: ToolExecutionContext = {
          message,
          user: message.author,
          channel: message.channel,
          logger: context.logger,
        };

        context.logger.debug('Executing tool', {
          tool: toolName,
          args,
        });

        const result = await tool.execute(args, execContext);
        const durationMs = Date.now() - toolStartTime;

        context.eventBus.fire('ai:tool_result', {
          messageId: message.id,
          toolName,
          toolCallId: toolCall.id,
          success: result.success,
          durationMs,
          result: result.success ? result.data : undefined,
          error: result.success ? undefined : result.error?.message,
        });

        context.logger.info('Tool executed', {
          tool: toolName,
          success: result.success,
          durationMs,
        });

        messages.push({
          role: 'tool',
          content: JSON.stringify(result.success ? result.data : result.error),
          tool_call_id: toolCall.id,
        });
      } catch (error) {
        const durationMs = Date.now() - toolStartTime;
        const errorMessage = error instanceof Error ? error.message : String(error);

        context.eventBus.fire('ai:tool_result', {
          messageId: message.id,
          toolName,
          toolCallId: toolCall.id,
          success: false,
          durationMs,
          error: errorMessage,
        });

        context.logger.error('Tool execution failed', {
          tool: toolName,
          error: errorMessage,
          durationMs,
        });

        messages.push({
          role: 'tool',
          content: JSON.stringify({ error: errorMessage }),
          tool_call_id: toolCall.id,
        });
      }
    }

    // Get final response after tool execution
    context.logger.debug('Getting final response after tool calls');
    const response = await this.llm.chat({ messages });
    const content = response.choices[0]?.message.content;

    if (content) {
      await this.sendResponse(message, content, context);
    }

    return { toolsUsed, content };
  }

  /**
   * Send a response message
   * Converts @name mentions back to platform-specific format
   */
  private async sendResponse(message: BotMessage, content: string, context: PluginContext): Promise<void> {
    // Convert @name mentions back to platform format
    const processedContent = this.convertMentionsForPlatform(message, content);

    // Split long messages (Discord limit is 2000 chars)
    const chunks = this.splitMessage(processedContent, 2000);

    for (let i = 0; i < chunks.length; i++) {
      context.eventBus.fire('message:send', {
        channelId: message.channel.id,
        message: {
          content: chunks[i],
          replyToId: i === 0 ? message.id : undefined, // Only reply to first chunk
        },
        platform: message.platform,
      });
    }
  }

  /**
   * Convert @name mentions in AI response to platform-specific format
   */
  private convertMentionsForPlatform(message: BotMessage, content: string): string {
    // Build reverse map: name → userId
    const nameToId = new Map<string, string>();

    // Add mentioned users
    for (const user of message.mentionedUsers) {
      const name = user.displayName ?? user.name;
      nameToId.set(name.toLowerCase(), user.id);
      nameToId.set(user.name.toLowerCase(), user.id);
    }

    // Add author
    const authorName = message.author.displayName ?? message.author.name;
    nameToId.set(authorName.toLowerCase(), message.author.id);
    nameToId.set(message.author.name.toLowerCase(), message.author.id);

    // Replace @name with platform-specific mention
    // Both Discord and Slack use <@USERID> format
    return content.replace(/@(\w+)/g, (match, name) => {
      const userId = nameToId.get(name.toLowerCase());
      if (userId) {
        return `<@${userId}>`;
      }
      return match; // Keep as-is if no match
    });
  }

  /**
   * Split a message into chunks respecting word boundaries
   */
  private splitMessage(content: string, maxLength: number): string[] {
    if (content.length <= maxLength) return [content];

    const chunks: string[] = [];
    let remaining = content;

    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        chunks.push(remaining);
        break;
      }

      // Find a good break point
      let breakPoint = remaining.lastIndexOf('\n', maxLength);
      if (breakPoint === -1 || breakPoint < maxLength / 2) {
        breakPoint = remaining.lastIndexOf(' ', maxLength);
      }
      if (breakPoint === -1 || breakPoint < maxLength / 2) {
        breakPoint = maxLength;
      }

      chunks.push(remaining.substring(0, breakPoint));
      remaining = remaining.substring(breakPoint).trimStart();
    }

    return chunks;
  }

  /**
   * Get all loaded tools
   */
  getTools(): Tool[] {
    return [...this.loadedTools.all];
  }
}
