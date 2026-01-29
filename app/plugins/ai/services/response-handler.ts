import type {
  BotConfig,
  BotMessage,
  ChatMessage,
  LLMClient,
  PluginContext,
  Tool,
  ToolCall,
  ToolExecutionContext,
} from '@core';
import type { RequestTracker } from './request-tracker';

export class ResponseHandler {
  private static readonly MAX_TOOL_DEPTH = 5;

  constructor(
    _config: BotConfig | undefined,
    private llm: LLMClient | undefined,
    private requestTracker: RequestTracker | undefined,
  ) {}

  /**
   * Handle tool calls from the LLM
   */
  async handleToolCalls(
    message: BotMessage,
    toolCalls: ToolCall[],
    messages: ChatMessage[],
    accessibleTools: Tool[],
    context: PluginContext,
    depth: number = 0,
  ): Promise<{ toolsUsed: string[]; content: string | null }> {
    if (!this.llm) return { toolsUsed: [], content: null };

    // Check depth limit to prevent infinite recursion
    if (depth >= ResponseHandler.MAX_TOOL_DEPTH) {
      context.logger.warn('Max tool call depth reached', { depth, messageId: message.id });
      return {
        toolsUsed: [],
        content: '⚠️ I had to stop processing because I was making too many tool calls. Please try a simpler request.',
      };
    }

    const toolsUsed: string[] = [];

    // Add assistant message with tool calls
    messages.push({
      role: 'assistant',
      content: null,
      tool_calls: toolCalls,
    });

    const toolNames = toolCalls.map((tc) => tc.function.name);
    context.logger.info('Processing tool calls in parallel', {
      messageId: message.id,
      toolCount: toolCalls.length,
      tools: toolNames,
    });

    // Execute tool calls in parallel
    const toolResults = await Promise.all(
      toolCalls.map(async (toolCall) => {
        const toolName = toolCall.function.name;
        const tool = accessibleTools.find((t) => t.schema.name === toolName);
        const toolStartTime = Date.now();

        // Parse arguments
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(toolCall.function.arguments);
        } catch {
          args = { _raw: toolCall.function.arguments };
        }

        // Inject reference image if needed
        if (toolName === 'image_generation') {
          args = this.injectReferenceImageIfNeeded(args, message);
        }

        // Check for duplicate in-flight requests (image_generation only)
        if (toolName === 'image_generation' && this.requestTracker) {
          const similar = await this.requestTracker.findSimilar(message.channel.id, toolName, args);

          if (similar) {
            // Skip execution - return "already in progress" message
            const truncatedSummary =
              similar.summary.length > 50 ? `${similar.summary.slice(0, 47)}...` : similar.summary;
            context.logger.info('[ResponseHandler] Skipping duplicate image generation', {
              messageId: message.id,
              similar: truncatedSummary,
            });

            return {
              toolCall,
              toolName,
              success: true,
              durationMs: 0,
              content: JSON.stringify({
                success: true,
                message: `A similar image is already being generated: "${truncatedSummary}". Please wait for it to complete.`,
              }),
            };
          }
        }

        context.eventBus.fire('ai:tool_call', {
          messageId: message.id,
          toolName,
          toolCallId: toolCall.id,
          arguments: args,
        });

        // Handle missing tool
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

          return {
            toolCall,
            toolName,
            success: false,
            durationMs: 0,
            content: JSON.stringify({ error: `Tool ${toolName} not found` }),
          };
        }

        // Track pending request
        let requestId: string | undefined;
        if (toolName === 'image_generation' && this.requestTracker) {
          requestId = await this.requestTracker.addPending(message.channel.id, toolName, args, message.id);
          context.logger.debug('[ResponseHandler] Tracking pending request', {
            messageId: message.id,
            requestId,
            toolName,
          });
        }

        // Execute tool with error isolation
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

          const toolResultContent = result.success
            ? result.data
            : {
                error: true,
                type: result.error?.type ?? 'unknown_error',
                message: result.error?.message ?? 'Tool execution failed',
                suggestion: 'Please inform the user about this error and suggest alternatives if possible.',
              };

          return {
            toolCall,
            toolName,
            success: result.success,
            durationMs,
            content: JSON.stringify(toolResultContent),
          };
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

          return {
            toolCall,
            toolName,
            success: false,
            durationMs,
            content: JSON.stringify({ error: errorMessage }),
          };
        } finally {
          // Remove from pending (always cleanup, even on error)
          if (requestId && this.requestTracker) {
            this.requestTracker.removePending(message.channel.id, requestId);
            context.logger.debug('[ResponseHandler] Removed pending request', {
              messageId: message.id,
              requestId,
              toolName,
            });
          }
        }
      }),
    );

    // Log parallel execution results
    const totalDuration = Math.max(...toolResults.map((r) => r.durationMs));
    const successCount = toolResults.filter((r) => r.success).length;
    context.logger.info('Parallel tool execution completed', {
      messageId: message.id,
      totalDuration,
      successCount,
      failureCount: toolResults.length - successCount,
    });

    // Add tool names to toolsUsed array (only successful ones with actual tools)
    for (const result of toolResults) {
      if (result.success && result.toolName !== 'Tool not found') {
        toolsUsed.push(result.toolName);
      }
    }

    // Push tool results to messages array in original order
    for (const result of toolResults) {
      messages.push({
        role: 'tool',
        content: result.content,
        tool_call_id: result.toolCall.id,
      } as import('@core').ChatMessage);
    }

    // Track if any tools failed
    const failedTools = messages
      .filter((m) => m.role === 'tool')
      .filter((m) => {
        try {
          const contentStr = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
          const parsed = JSON.parse(contentStr ?? '{}');
          return parsed.error === true || parsed.error;
        } catch {
          return false;
        }
      });

    // Get final response after tool execution
    context.logger.debug('Getting final response after tool calls');
    const llmCallStartTime = Date.now();
    const response = await this.llm.chat({ messages });
    const llmCallDuration = Date.now() - llmCallStartTime;
    const contentRaw = response.choices[0]?.message.content ?? null;
    const content = typeof contentRaw === 'string' ? contentRaw : null;
    const finishReason = response.choices[0]?.finish_reason;
    const newToolCalls = response.choices[0]?.message.tool_calls;

    context.logger.info('Second LLM call completed', {
      messageId: message.id,
      durationMs: llmCallDuration,
      hasContent: !!content,
      finishReason,
      hasNewToolCalls: !!newToolCalls && newToolCalls.length > 0,
      newToolCallCount: newToolCalls?.length ?? 0,
    });

    if (newToolCalls && newToolCalls.length > 0) {
      context.logger.info('LLM returned more tool calls - recursively handling', {
        messageId: message.id,
        newToolCount: newToolCalls.length,
        currentDepth: depth,
      });

      const result = await this.handleToolCalls(message, newToolCalls, messages, accessibleTools, context, depth + 1);
      toolsUsed.push(...result.toolsUsed);
      return { toolsUsed, content: result.content };
    }

    if (content) {
      await this.sendResponse(message, content, context);
    } else if (failedTools.length > 0) {
      context.logger.warn('LLM returned no content after tool failures', {
        failedToolCount: failedTools.length,
        errors: 'Tools failed',
      });

      await this.sendResponse(
        message,
        '❌ The tool encountered an error. Please try again with a different approach.',
        context,
      );
    } else {
      context.logger.error('LLM returned no content with no tool calls', {
        messageId: message.id,
        finishReason,
      });

      await this.sendResponse(message, '❌ I encountered an issue processing your request. Please try again.', context);
    }

    return { toolsUsed, content };
  }

  /**
   * Send a response message
   */
  async sendResponse(message: BotMessage, content: string, context: PluginContext): Promise<void> {
    // Convert @name mentions back to platform format
    const processedContent = await this.convertMentionsForPlatform(message, content, context.eventBus);

    // Split long messages
    const chunks = this.splitMessage(processedContent, 2000);

    for (let i = 0; i < chunks.length; i++) {
      context.eventBus.fire('message:send', {
        channelId: message.channel.id,
        message: {
          content: chunks[i],
          replyToId: i === 0 ? message.id : undefined, // Discord: reply reference to first chunk
          threadId: message.threadId, // Stay in thread if original was in thread (Slack)
        },
        platform: message.platform,
      });
    }
  }

  /**
   * Inject reference image URL into tool arguments if user is replying to an image
   */
  private injectReferenceImageIfNeeded(args: Record<string, unknown>, message: BotMessage): Record<string, unknown> {
    // Only inject if not already present
    if (args.reference_image_url) return args;

    // Check attachments
    const images = message.attachments.filter(
      (a) => a.contentType?.startsWith('image/') || /\.(png|jpg|jpeg|gif|webp)$/i.test(a.filename),
    );

    if (images.length > 0 && images[0]) {
      return { ...args, reference_image_url: images[0].url };
    }

    return args;
  }

  /**
   * Convert @name mentions in AI response to platform-specific format
   */
  private async convertMentionsForPlatform(
    message: BotMessage,
    content: string,
    eventBus?: import('@core').EventBus,
  ): Promise<string> {
    // Build reverse map: name → userId (case-insensitive) from known users
    const nameToId = new Map<string, string>();

    // Add mentioned users
    for (const user of message.mentionedUsers) {
      const displayName = user.displayName ?? user.name;
      nameToId.set(displayName.toLowerCase(), user.id);
      nameToId.set(user.name.toLowerCase(), user.id);
    }

    // Add author
    const authorDisplayName = message.author.displayName ?? message.author.name;
    nameToId.set(authorDisplayName.toLowerCase(), message.author.id);
    nameToId.set(message.author.name.toLowerCase(), message.author.id);

    // Extract all @name patterns from content (word characters, including underscores)
    const mentionPattern = /@(\w+)/g;
    const mentionMatches = [...content.matchAll(mentionPattern)];
    const uniqueNames = [...new Set(mentionMatches.map((m) => m[1]?.toLowerCase() ?? ''))].filter(Boolean);

    // For each unique name, try to resolve it if not already known
    for (const name of uniqueNames) {
      if (nameToId.has(name)) continue; // Already known

      // Try to resolve via platform's user directory
      if (eventBus && message.guildId) {
        const userId = await this.resolveUserName(eventBus, message.platform, name, message.guildId);
        if (userId) {
          nameToId.set(name, userId);
        }
      }
    }

    // Sort names by length (longest first) to avoid partial replacements
    const sortedNames = Array.from(nameToId.keys()).sort((a, b) => b.length - a.length);

    // Replace @name with platform-specific mention
    let result = content;
    for (const name of sortedNames) {
      const regex = new RegExp(`@${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
      const userId = nameToId.get(name);
      if (userId) {
        result = result.replace(regex, `<@${userId}>`);
      }
    }

    return result;
  }

  /**
   * Resolve a username to user ID via platform adapter
   */
  private resolveUserName(
    eventBus: import('@core').EventBus,
    platform: import('@core').Platform,
    name: string,
    guildId: string,
  ): Promise<string | null> {
    return new Promise((resolve) => {
      // Set a timeout in case the adapter doesn't respond
      const timeout = setTimeout(() => resolve(null), 1500);

      eventBus.emit('user:resolve', {
        platform,
        name,
        guildId,
        callback: (userId: string | null) => {
          clearTimeout(timeout);
          resolve(userId);
        },
      });
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

      let splitIndex = remaining.lastIndexOf('\n', maxLength);
      if (splitIndex === -1) splitIndex = remaining.lastIndexOf(' ', maxLength);
      if (splitIndex === -1) splitIndex = maxLength;

      chunks.push(remaining.substring(0, splitIndex));
      remaining = remaining.substring(splitIndex).trim();
    }

    return chunks;
  }
}
