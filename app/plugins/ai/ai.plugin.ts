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
import { getUserApiKey, getUserByPlatformId, getUserDefaultModel } from '@core/database';
import path from 'path';
import { ConversationService } from './services/conversation';
import { ImageProcessor } from './services/image-processor';
import { RequestTracker } from './services/request-tracker';
import { ResponseHandler } from './services/response-handler';

/** Fallback model if not configured */
const FALLBACK_MODEL = 'x-ai/grok-4.1-fast';

export class AIPlugin implements MessageHandlerPlugin {
  readonly id = 'ai';
  readonly type = 'message' as const;
  // Only respond when mentioned (default behavior)

  private context?: PluginContext;
  private loadedTools: LoadedTools = { all: [], accessConfig: new Map() };
  private defaultLlm?: LLMClient;
  private config?: BotConfig;
  private defaultModel: string = FALLBACK_MODEL;

  // Services
  private conversationService!: ConversationService;
  private responseHandler!: ResponseHandler;
  private imageProcessor!: ImageProcessor;
  private requestTracker?: RequestTracker;

  async load(context: PluginContext): Promise<void> {
    this.context = context;

    // Load bot configuration
    this.config = getBotConfig();
    this.defaultModel = this.config.ai?.defaultModel ?? FALLBACK_MODEL;

    // Initialize services
    this.imageProcessor = new ImageProcessor();

    // Initialize request tracker for duplicate detection
    this.requestTracker = new RequestTracker(context.logger);

    this.conversationService = new ConversationService(this.config, this.imageProcessor, this.requestTracker);

    // Initialize LLM client with API key from config
    const apiKey = this.config.tokens.openrouter;
    if (!apiKey) {
      context.logger.warn('OpenRouter API key not set in config - AI plugin will not work');
      return;
    }

    this.defaultLlm = createOpenRouterClient(apiKey, {
      baseUrl: this.config.ai?.openRouterBaseUrl,
      defaultModel: this.defaultModel,
      defaultTemperature: this.config.ai?.temperature,
      defaultMaxTokens: this.config.ai?.maxTokens,
      timeout: 180000,
      headers: {
        'HTTP-Referer': 'https://github.com/bot',
        'X-Title': this.config.bot.name,
      },
    });

    this.responseHandler = new ResponseHandler(this.config, this.defaultLlm, this.requestTracker);

    // Load tools from the tools directory (filtered by config)
    const toolsDir = path.join(import.meta.dir, 'tools');
    this.loadedTools = await loadTools({
      toolsDir,
      logger: context.logger,
      config: this.config,
    });

    context.logger.info('AIPlugin loaded', {
      model: this.defaultModel,
      botName: this.config.bot.name,
      tools: this.loadedTools.all.map((t) => t.metadata.name),
    });
  }

  async unload(): Promise<void> {
    this.context?.logger.info('AIPlugin unloaded');
    this.context = undefined;
    this.loadedTools = { all: [], accessConfig: new Map() };
    this.defaultLlm = undefined;
    this.config = undefined;

    if (this.requestTracker) {
      this.requestTracker.destroy();
      this.requestTracker = undefined;
    }
  }

  shouldHandle(message: BotMessage): boolean {
    // Don't respond to bots
    if (message.author.isBot) return false;

    // Always handle when mentioned (scope filtering already done)
    return true;
  }

  /**
   * Handle incoming message - main entry point
   */
  async handle(message: BotMessage, context: PluginContext): Promise<void> {
    const startTime = Date.now();
    const toolsUsed: string[] = [];

    if (!this.defaultLlm) {
      context.logger.error('LLM client not initialized');
      return;
    }

    // Determine LLM client and model to use (per-user API keys/models)
    let llmClient = this.defaultLlm;
    let modelToUse = this.defaultModel;
    let responseHandler = this.responseHandler;
    let usingUserKey = false;

    try {
      // Get the user's internal database ID
      const dbUser = await getUserByPlatformId(message.platform, message.author.id);
      const userId = dbUser?.id;

      if (userId) {
        // Check for user's custom API key FIRST
        // User settings (model, etc.) only apply if they have their own API key
        const userApiKey = getUserApiKey(userId);
        if (userApiKey) {
          usingUserKey = true;
          context.logger.debug('Using user custom API key', { userId });

          // Only check for user's custom model if they have an API key
          const userModel = getUserDefaultModel(userId);
          if (userModel) {
            modelToUse = userModel;
            context.logger.debug('Using user custom model', { userId, model: userModel });
          }

          // Create a temporary client with user's key
          llmClient = createOpenRouterClient(userApiKey, {
            baseUrl: this.config?.ai?.openRouterBaseUrl,
            defaultModel: modelToUse,
            defaultTemperature: this.config?.ai?.temperature,
            defaultMaxTokens: this.config?.ai?.maxTokens,
            timeout: 180000,
            headers: {
              'HTTP-Referer': 'https://github.com/bot',
              'X-Title': this.config?.bot.name ?? 'Bot',
            },
          });

          // Create a response handler with the user's client for tool call follow-ups
          responseHandler = new ResponseHandler(this.config, llmClient, this.requestTracker);
        }
      }
    } catch (error) {
      // If we fail to lookup user settings, just use defaults
      context.logger.warn('Failed to lookup user settings, using defaults', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Emit processing started event
    context.eventBus.fire('ai:processing', {
      messageId: message.id,
      userId: message.author.id,
      channelId: message.channel.id,
      content: message.content.substring(0, 200),
      model: modelToUse,
    });

    context.logger.info('AI processing started', {
      messageId: message.id,
      author: message.author.name,
      contentLength: message.content.length,
      hasImages: message.attachments.some((a) => a.contentType?.startsWith('image/')),
      usingUserKey,
      model: modelToUse,
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

      // Call the LLM (using user's client if available)
      const response = await llmClient.chat({
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
        const result = await responseHandler.handleToolCalls(
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
            model: modelToUse,
            toolsUsed,
            totalDurationMs: Date.now() - startTime,
            promptTokens: response.usage?.prompt_tokens,
            completionTokens: response.usage?.completion_tokens,
          });
        } else {
          // Second LLM call failed or returned null - send fallback message
          context.logger.warn('[AIPlugin] Tool calls completed but no final response generated', {
            messageId: message.id,
            toolsUsed,
          });

          await responseHandler.sendResponse(
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

        await responseHandler.sendResponse(message, contentStr, context);

        // Emit response event
        context.eventBus.fire('ai:response', {
          messageId: message.id,
          content: contentStr.substring(0, 200),
          model: modelToUse,
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

      // Check if this might be a user API key issue
      const isApiKeyError =
        usingUserKey &&
        (errorMessage.toLowerCase().includes('invalid') ||
          errorMessage.toLowerCase().includes('unauthorized') ||
          errorMessage.toLowerCase().includes('401') ||
          errorMessage.toLowerCase().includes('api key'));

      if (isApiKeyError) {
        context.logger.warn('User API key may be invalid, consider falling back', {
          messageId: message.id,
          error: errorMessage,
        });
      }

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
      } else if (isApiKeyError) {
        // Don't expose API key details to user
        userMessage = '❌ There was an issue with your API configuration. Please check your settings.';
      }

      await responseHandler.sendResponse(message, userMessage, context);
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
   * Get all loaded tools
   */
  getTools(): Tool[] {
    return [...this.loadedTools.all];
  }
}
