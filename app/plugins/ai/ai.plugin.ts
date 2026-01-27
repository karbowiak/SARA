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
  createOpenRouterClient,
  getAccessibleTools,
  getBotConfig,
  LLMClient,
  type LoadedTools,
  loadTools,
  type MessageHandlerPlugin,
  type PluginContext,
  type Tool,
} from '@core';
import path from 'path';
import { ConversationService } from './services/conversation';
import { ImageProcessor } from './services/image-processor';
import { ResponseHandler } from './services/response-handler';

/** Fallback model if not configured */
const FALLBACK_MODEL = 'x-ai/grok-4.1-fast';

/** Number of recent messages to include in conversation history */
const HISTORY_LIMIT = 5;

export class AIPlugin implements MessageHandlerPlugin {
  readonly id = 'ai';
  readonly type = 'message' as const;
  // Only respond when mentioned (default behavior)

  private context?: PluginContext;
  private loadedTools: LoadedTools = { all: [], accessConfig: new Map() };
  private llm?: LLMClient;
  private config?: BotConfig;
  private model: string = FALLBACK_MODEL;

  // Services
  private conversationService!: ConversationService;
  private responseHandler!: ResponseHandler;
  private imageProcessor!: ImageProcessor;

  async load(context: PluginContext): Promise<void> {
    this.context = context;

    // Load bot configuration
    this.config = getBotConfig();
    this.model = this.config.ai?.defaultModel ?? FALLBACK_MODEL;

    // Initialize services
    this.imageProcessor = new ImageProcessor();
    this.conversationService = new ConversationService(this.config, this.imageProcessor);

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
      timeout: 180000,
      headers: {
        'HTTP-Referer': 'https://github.com/bot',
        'X-Title': this.config.bot.name,
      },
    });

    this.responseHandler = new ResponseHandler(this.config, this.llm);

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

    // DEBUG: Check if handle is being called multiple times
    context.logger.debug('[AIPlugin] handle() called', {
      messageId: message.id,
      content: message.content.substring(0, 50),
    });

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
      const messages = await this.conversationService.buildMessages(message, accessibleTools, context);

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
        const result = await this.responseHandler.handleToolCalls(
          message,
          choice.message.tool_calls,
          messages,
          accessibleTools,
          context,
        );
        toolsUsed.push(...result.toolsUsed);

        // Check if we got a final response from the second LLM call
        if (result.content) {
          // Emit response event
          context.eventBus.fire('ai:response', {
            messageId: message.id,
            content: result.content.substring(0, 200),
            model: this.model,
            toolsUsed,
            totalDurationMs: Date.now() - startTime,
            promptTokens: response.usage?.prompt_tokens,
            completionTokens: response.usage?.completion_tokens,
          });
          context.logger.debug('[AIPlugin] About to send response', {
            messageId: message.id,
            contentLength: result.content.length,
            content: result.content.substring(0, 100),
          });
        } else {
          // Second LLM call failed or returned null - send fallback message
          context.logger.warn('[AIPlugin] Tool calls completed but no final response generated', {
            messageId: message.id,
            toolsUsed,
          });

          await this.responseHandler.sendResponse(
            message,
            '✅ Tool executed successfully, but I encountered an issue generating a final response.',
            context,
          );
        }

        return;
      }

      // Send the response
      const content = choice.message.content;
      if (content) {
        // Convert content to string if it's an array (multimodal)
        const contentStr = Array.isArray(content)
          ? content.map((p) => (p.type === 'text' ? p.text : '[image]')).join(' ')
          : content;

        await this.responseHandler.sendResponse(message, contentStr, context);

        // Emit response event
        context.eventBus.fire('ai:response', {
          messageId: message.id,
          content: contentStr.substring(0, 200),
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

      let userMessage = '❌ Sorry, I encountered an error processing your request.';

      const errorMessageLower = errorMessage.toLowerCase();

      if (errorMessageLower.includes('timeout')) {
        userMessage = '⏱️ Request timed out. Please try again or simplify your request.';
      } else if (errorMessageLower.includes('rate limit') || errorMessageLower.includes('429')) {
        userMessage = '⚠️ Rate limited. Please wait a moment and try again.';
      } else if (errorMessageLower.includes('moderation') || errorMessageLower.includes('content_filter')) {
        userMessage = '🚫 Your request was filtered by content safety systems.';
      }

      await this.responseHandler.sendResponse(message, userMessage, context);
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
  ): Promise<string | null> {
    if (!this.context) return Promise.resolve(null);

    return new Promise((resolve) => {
      this.context?.eventBus.emit('user:resolve', {
        platform,
        name,
        guildId,
        callback: resolve,
      });

      setTimeout(() => resolve(null), 1500);
    });
  }

  /**
   * Inject reference image URL into image_generation args when the user likely wants edits
   */
  private injectReferenceImageIfNeeded(args: Record<string, unknown>, message: BotMessage): Record<string, unknown> {
    const hasReference = typeof args.reference_image_url === 'string' && args.reference_image_url.length > 0;
    const images = this.imageProcessor.getImageAttachments(message);
    const shouldUse = this.shouldUseReferenceImage(message);
    if (!hasReference && (images.length === 0 || !shouldUse)) return args;

    const updated: Record<string, unknown> = {
      ...args,
      reference_image_url: hasReference ? args.reference_image_url : images[0]?.url,
    };

    // Preserve reference sizing unless the user explicitly asked for a ratio/resolution
    if (!this.userSpecifiedAspectRatio(message.content)) {
      delete updated.aspect_ratio;
    }
    if (!this.userSpecifiedResolution(message.content)) {
      delete updated.resolution;
    }

    return updated;
  }

  /**
   * Heuristic: decide if the user is asking to edit/transform the attached image
   */
  private shouldUseReferenceImage(message: BotMessage): boolean {
    if (this.imageProcessor.getImageAttachments(message).length === 0) return false;

    const text = message.content.toLowerCase();
    if (!text) return true;

    const triggers = [
      'use this',
      'use the image',
      'use this image',
      'based on this',
      'based on the',
      'reference',
      'edit',
      'modify',
      'change',
      'remove',
      'add',
      'replace',
      'swap',
      'turn into',
      'transform',
      'restyle',
      'style',
      'color',
      'colorize',
      'enhance',
      'upscale',
      'background',
      'make it',
      'make this',
      'fix',
      'clean up',
      'retouch',
      'mask',
      'inpaint',
    ];

    return triggers.some((t) => text.includes(t));
  }

  private userSpecifiedAspectRatio(text: string): boolean {
    const ratioPattern = /\b(1:1|2:3|3:2|3:4|4:3|4:5|5:4|9:16|16:9|21:9)\b/i;
    if (ratioPattern.test(text)) return true;

    const wordPattern =
      /\b(square|portrait|landscape|widescreen|ultrawide|vertical|horizontal|instagram|stories|phone)\b/i;
    return wordPattern.test(text);
  }

  private userSpecifiedResolution(text: string): boolean {
    const pattern = /\b(1k|2k|4k|1024|2048|4096)\b/i;
    return pattern.test(text);
  }

  /**
   * Get all loaded tools
   */
  getTools(): Tool[] {
    return [...this.loadedTools.all];
  }
}
