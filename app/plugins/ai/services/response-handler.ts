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
import { getBotConfig } from '@core';

export class ResponseHandler {
  constructor(
    private config: BotConfig | undefined,
    private llm: LLMClient | undefined,
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

      // If user provided an image and is asking for edits, pass reference image to image_generation
      if (toolName === 'image_generation') {
        args = this.injectReferenceImageIfNeeded(args, message);
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

        // Format error messages more descriptively for the LLM
        const toolResultContent = result.success
          ? result.data
          : {
              error: true,
              type: result.error?.type ?? 'unknown_error',
              message: result.error?.message ?? 'Tool execution failed',
              suggestion: 'Please inform the user about this error and suggest alternatives if possible.',
            };

        messages.push({
          role: 'tool',
          content: JSON.stringify(toolResultContent),
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

    // Track if any tools failed
    const failedTools = messages
      .filter((m) => m.role === 'tool')
      .filter((m) => {
        try {
          const parsed = JSON.parse(m.content ?? '{}');
          return parsed.error === true || parsed.error;
        } catch {
          return false;
        }
      });

    // Get final response after tool execution
    context.logger.debug('Getting final response after tool calls');
    const response = await this.llm.chat({ messages });
    const content = response.choices[0]?.message.content ?? null;

    if (content) {
      await this.sendResponse(message, content, context);
    } else if (failedTools.length > 0) {
      // LLM didn't respond but tools failed - send fallback error
      const errorMessages = failedTools
        .map((m) => {
          try {
            const parsed = JSON.parse(m.content ?? '{}');
            return parsed.message ?? 'Unknown error';
          } catch {
            return 'Unknown error';
          }
        })
        .join('; ');

      context.logger.warn('LLM returned no content after tool failures', {
        failedToolCount: failedTools.length,
        errors: errorMessages,
      });

      await this.sendResponse(
        message,
        `❌ The tool encountered an error: ${errorMessages}\n\nPlease try again with a different approach.`,
        context,
      );
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

    if (images.length > 0) {
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
    const uniqueNames = [...new Set(mentionMatches.map((m) => m[1].toLowerCase()))];

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
