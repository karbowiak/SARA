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
import { getRecentMessages } from '@core/database';
import path from 'path';
import { buildFullSystemPrompt } from '../../helpers/prompt-builder';

/** Fallback model if not configured */
const FALLBACK_MODEL = 'x-ai/grok-4.1-fast';

/** Number of recent messages to include in conversation history */
const HISTORY_LIMIT = 20;

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
    return getAccessibleTools(this.loadedTools.all, accessContext, config);
  }

  /**
   * Build chat messages from the incoming message
   *
   * Structure:
   * 1. System prompt with config, memories, and semantic search results
   * 2. Proper multi-turn conversation history (user/assistant alternating)
   * 3. Current user message
   *
   * Uses proper OpenAI/OpenRouter conversation format with alternating roles.
   */
  private async buildMessages(message: BotMessage, tools: Tool[], context: PluginContext): Promise<ChatMessage[]> {
    const config = this.config ?? getBotConfig();

    // Check if user is replying to a failed image generation request
    const imageRetryContext = await this.detectImageRetryContext(message, context);
    if (imageRetryContext) {
      context.logger.info('Detected image retry context', { messageId: message.id });
    }

    // Build system prompt with all context using centralized helper
    const { systemPrompt, debug } = await buildFullSystemPrompt(config, {
      messageContent: message.content,
      platform: message.platform,
      guildId: message.guildId,
      channelId: message.channel.id,
      userId: message.author.id,
      userName: message.author.displayName ?? message.author.name,
      tools: tools.length > 0 ? tools : undefined,
      additionalContext: imageRetryContext ?? undefined,
    });

    // Log what was loaded
    if (debug.memoriesCount > 0 || debug.knowledgeCount > 0 || debug.semanticResultsCount > 0) {
      context.logger.debug('System prompt context loaded', {
        memories: debug.memoriesCount,
        knowledge: debug.knowledgeCount,
        semanticResults: debug.semanticResultsCount,
        topKnowledgeScore: debug.topKnowledgeScore?.toFixed(3),
        topSemanticScore: debug.topSemanticScore?.toFixed(3),
      });
    }

    const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt }];

    // Build proper multi-turn conversation history
    const historyMessages = this.buildConversationHistory(message);
    messages.push(...historyMessages);

    // Add current user message
    const userContent = this.buildUserContent(message);
    messages.push({ role: 'user', content: userContent });

    return messages;
  }

  /**
   * Build proper multi-turn conversation history from recent messages
   *
   * Returns alternating user/assistant messages in chronological order.
   * Groups consecutive messages from the same role together.
   */
  private buildConversationHistory(currentMessage: BotMessage): ChatMessage[] {
    const config = this.config ?? getBotConfig();
    const botName = config?.bot.name ?? 'Bot';

    try {
      // Get recent messages from database (excluding current message)
      const recentMessages = getRecentMessages(currentMessage.channel.id, HISTORY_LIMIT + 1);

      // Filter out the current message and reverse to chronological order
      const history = recentMessages
        .filter((m) => m.platform_message_id !== currentMessage.id)
        .slice(0, HISTORY_LIMIT)
        .reverse();

      if (history.length === 0) return [];

      const messages: ChatMessage[] = [];
      let currentRole: 'user' | 'assistant' | null = null;
      let currentContent: string[] = [];

      const flushCurrentMessage = () => {
        if (currentRole && currentContent.length > 0) {
          messages.push({
            role: currentRole,
            content: currentContent.join('\n'),
          });
          currentContent = [];
        }
      };

      for (const msg of history) {
        const isBot = Boolean(msg.is_bot);
        const role: 'user' | 'assistant' = isBot ? 'assistant' : 'user';
        const userName = isBot ? botName : (msg.display_name ?? msg.username ?? 'Unknown');

        // Format message with author prefix for user messages (helps AI know who said what)
        const formattedContent = isBot ? msg.content : `@${userName}: ${msg.content}`;

        // If role changed, flush the previous message
        if (role !== currentRole) {
          flushCurrentMessage();
          currentRole = role;
        }

        currentContent.push(formattedContent);
      }

      // Flush any remaining content
      flushCurrentMessage();

      return messages;
    } catch (error) {
      console.error('[AIPlugin] Conversation history fetch error:', error);
      return [];
    }
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
   * Detect if user is replying to a failed image generation and extract context
   * Returns instruction text for the AI if detected, null otherwise
   */
  private async detectImageRetryContext(message: BotMessage, context: PluginContext): Promise<string | null> {
    // Check if this message is a reply
    if (!message.replyToId) return null;

    try {
      // First try to get from database (for regular bot messages)
      const recentMessages = getRecentMessages(message.channel.id, 50);
      let content: string | undefined = recentMessages.find(
        (m) => m.platform_message_id === message.replyToId && m.is_bot,
      )?.content;

      // If not in database, fetch directly from platform (for interaction replies like /imagine)
      if (!content) {
        const fetched = await this.fetchMessageContent(
          message.channel.id,
          message.replyToId,
          message.platform,
          context,
        );
        content = fetched ?? undefined;
      }

      if (!content) return null;

      // Check for our specific failure format from /imagine
      if (!content.includes('❌ **Image generation failed**')) return null;

      // Extract the original request details
      const promptMatch = content.match(/\*\*Original request:\*\* (.+?)(?:\n|$)/);
      const styleMatch = content.match(/\*\*Style:\*\* (.+?)(?:\n|$)/);
      const aspectMatch = content.match(/\*\*Aspect:\*\* (\d+:\d+)/);
      const resolutionMatch = content.match(/\*\*Resolution:\*\* (\d+K)/);

      if (!promptMatch) return null;

      const originalPrompt = promptMatch[1]?.trim();
      const style = styleMatch?.[1]?.trim();
      const aspect = aspectMatch?.[1] ?? '1:1';
      const resolution = resolutionMatch?.[1] ?? '1K';

      // Build instruction for the AI
      return `# ACTION REQUIRED: Image Generation Retry

The user is replying to a FAILED image generation. You MUST call image_generation immediately.

## Original Request (use these EXACT values):
- Prompt: "${originalPrompt}"
${style ? `- Style: "${style}"` : '- Style: (none specified)'}
- Aspect ratio: ${aspect}
- Resolution: ${resolution}

## CRITICAL Instructions:
1. Use the EXACT original prompt above as your base
2. Apply ONLY the minimal change the user requested - do NOT rewrite or reimagine the prompt
3. If user says "ok" or "try again" - use the original prompt unchanged
4. If user gives a specific fix (e.g., "make her older") - change ONLY that part
5. Keep all other details, style, composition, and descriptors from the original
6. PRESERVE the original style, aspect_ratio, and resolution settings - pass them to the tool

Call image_generation NOW with: the corrected prompt, style="${style || ''}", aspect_ratio="${aspect}", resolution="${resolution}".`;
    } catch {
      return null;
    }
  }

  /**
   * Fetch message content from platform via event bus
   */
  private fetchMessageContent(
    channelId: string,
    messageId: string,
    platform: string,
    context: PluginContext,
  ): Promise<string | null> {
    return new Promise((resolve) => {
      context.eventBus.emit('message:fetch', {
        channelId,
        messageId,
        platform: platform as 'discord' | 'slack',
        callback: resolve,
      });

      // Timeout after 5 seconds
      setTimeout(() => resolve(null), 5000);
    });
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
          eventBus: context.eventBus,
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
    const content = response.choices[0]?.message.content ?? null;

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
