import type { BotConfig, BotMessage, ChatMessage, ContentPart, PluginContext, Tool } from '@core';
import { getBotConfig } from '@core';
import {
  getMessageByPlatformId,
  getRecentMessages,
  getUserByPlatformId,
  getUserWebhooks,
  type StoredMessage,
} from '@core/database';
import { buildFullSystemPrompt } from '../../../helpers/prompt-builder';
import type { ImageProcessor } from './image-processor';
import type { RequestTracker } from './request-tracker';

/** Number of recent messages to include in conversation history */
const HISTORY_LIMIT = 5;

export class ConversationService {
  private historyCache = new Map<string, { messages: StoredMessage[]; fetchedAt: number }>();

  constructor(
    private config: BotConfig | undefined,
    private imageProcessor: ImageProcessor,
    private requestTracker: RequestTracker | undefined,
  ) {}

  /**
   * Build chat messages from the incoming message
   *
   * Structure:
   * 1. System prompt with config, memories, channel history as context, and tools
   * 2. Current user message only (history is in system prompt, NOT as separate turns)
   */
  async buildMessages(message: BotMessage, tools: Tool[], context: PluginContext): Promise<ChatMessage[]> {
    const config = this.config ?? getBotConfig();

    // Check if user is replying to a failed image generation request
    const imageRetryContext = await this.detectImageRetryContext(message, context);
    if (imageRetryContext) {
      context.logger.info('Detected image retry context', { messageId: message.id });
    }

    // Add image attachment context (if any)
    const imageContext = this.imageProcessor.buildImageAttachmentContext(message);

    // Build channel history as formatted text (NOT as separate LLM turns)
    const channelHistory = this.buildChannelHistoryContext(message);

    // Build additional context sections
    const contextSections: string[] = [];
    if (imageRetryContext) contextSections.push(imageRetryContext);
    if (imageContext) contextSections.push(imageContext);

    // Add pending requests context
    const pendingContext = this.buildPendingRequestsContext(message);
    if (pendingContext) contextSections.push(pendingContext);

    // Add webhook context if user has webhooks configured AND has their own API key
    const webhookContext = this.buildWebhookContext(message);
    if (webhookContext) contextSections.push(webhookContext);

    // Combine sections
    const additionalContext = contextSections.length > 0 ? contextSections.join('\n\n---\n\n') : undefined;

    // Build system prompt with all context using centralized helper
    const { systemPrompt, debug } = await buildFullSystemPrompt(config, {
      messageContent: message.content,
      platform: message.platform,
      guildId: message.guildId,
      channelId: message.channel.id,
      channelName: message.channel.name,
      channelTopic: message.channel.topic,
      userId: message.author.id,
      userName: message.author.displayName ?? message.author.name,
      tools: tools.length > 0 ? tools : undefined,
      channelHistory: channelHistory || undefined,
      additionalContext,
    });

    // Log what was loaded
    if (
      debug.memoriesCount > 0 ||
      debug.historyCount > 0 ||
      debug.knowledgeCount > 0 ||
      debug.semanticResultsCount > 0
    ) {
      context.logger.debug('System prompt context loaded', {
        memories: debug.memoriesCount,
        history: debug.historyCount,
        knowledge: debug.knowledgeCount,
        semanticResults: debug.semanticResultsCount,
      });
    }

    const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt }];

    // Only add the current user message (history is in system prompt)
    const userContent = await this.buildUserContent(message);
    messages.push({ role: 'user', content: userContent });

    return messages;
  }

  /**
   * Build channel history as formatted text for system prompt injection
   * Returns a string with each message on a line, or null if no history
   */
  private buildChannelHistoryContext(currentMessage: BotMessage): string | null {
    const config = this.config ?? getBotConfig();
    const botName = config?.bot.name ?? 'Bot';
    const CACHE_TTL_MS = 30000; // 30 seconds

    try {
      // Check cache first
      const cached = this.historyCache.get(currentMessage.channel.id);

      if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
        // Use cached messages, filter out current message
        const historyMessages = cached.messages.filter((m) => m.platform_message_id !== currentMessage.id);
        return this.formatHistoryMessages(historyMessages, botName, currentMessage);
      }

      // Fetch from database and cache
      const recentMessages = getRecentMessages(currentMessage.channel.id, HISTORY_LIMIT + 1);
      this.historyCache.set(currentMessage.channel.id, {
        messages: recentMessages,
        fetchedAt: Date.now(),
      });

      // Filter out the current message and reverse to chronological order
      const history = recentMessages
        .filter((m) => m.platform_message_id !== currentMessage.id)
        .slice(0, HISTORY_LIMIT)
        .reverse();

      if (history.length === 0) return null;

      return this.formatHistoryMessages(history, botName, currentMessage);
    } catch (error) {
      console.error('[ConversationService] Channel history fetch error:', error);
      return null;
    }
  }

  /**
   * Format history messages into text lines
   */
  private formatHistoryMessages(history: StoredMessage[], botName: string, _currentMessage: BotMessage): string | null {
    // Filter messages older than 2 hours
    const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
    const cutoffTime = Date.now() - TWO_HOURS_MS;

    const lines: string[] = [];

    for (const msg of history) {
      // Skip old messages
      if (msg.created_at < cutoffTime) continue;

      const isBot = Boolean(msg.is_bot);
      const userName = isBot ? botName : (msg.display_name ?? msg.username ?? 'Unknown');

      // Format: "- @Username: message content" or "- @BotName: response"
      lines.push(`- @${userName}: ${msg.content}`);
    }

    return lines.length > 0 ? lines.join('\n') : null;
  }

  /**
   * Build context about pending requests in this channel
   * Informs the AI about what's already being processed
   */
  private buildPendingRequestsContext(message: BotMessage): string | null {
    if (!this.requestTracker) return null;

    const pending = this.requestTracker.getPendingForChannel(message.channel.id);
    if (pending.length === 0) return null;

    // Calculate elapsed time and format each pending request
    const lines = pending.map((p) => {
      const elapsedSeconds = Math.floor((Date.now() - p.startedAt) / 1000);
      return `- ${p.summary} (started ${elapsedSeconds}s ago)`;
    });

    return [
      '## Currently Processing',
      'These requests are already being handled in this channel:',
      ...lines,
      'Do NOT duplicate these requests.',
    ].join('\n');
  }

  /**
   * Build user message content, including images if present
   */
  private async buildUserContent(message: BotMessage): Promise<string | ContentPart[]> {
    // Convert mentions to readable format: <@123> → @username
    let content = message.content;

    // Build a map of user IDs to names from mentioned users
    const userMap = new Map<string, string>();
    for (const user of message.mentionedUsers) {
      userMap.set(user.id, user.displayName ?? user.name);
    }
    // Also include the author
    userMap.set(message.author.id, message.author.displayName ?? message.author.name);

    // Replace platform mentions with @name (Discord numeric, Slack alphanumeric)
    content = content.replace(/<@!?([A-Z0-9]+)>/g, (match, userId) => {
      const name = userMap.get(userId);
      return name ? `@${name}` : match;
    });

    // Remove bot self-mentions dynamically using config
    const botName = this.config?.bot.name ?? 'Bot';
    const botNamePattern = new RegExp(`@(${botName}|Bot)\\b`, 'gi');
    content = content.replace(botNamePattern, '').trim();

    // Prefix with @author so the AI knows who is talking
    const authorName = message.author.displayName ?? message.author.name;
    const images = this.imageProcessor.getImageAttachments(message);
    const fallback = images.length > 0 ? 'Please analyze the attached image(s).' : 'Hello!';
    const text = `@${authorName}: ${content || fallback}`;

    if (images.length === 0) {
      return text;
    }

    // Multimodal: convert all images to PNG data URLs
    const parts: ContentPart[] = [{ type: 'text', text }];
    const imageParts = await this.imageProcessor.buildImageParts(images);
    parts.push(...imageParts);
    return parts;
  }

  /**
   * Detect if user is replying to a failed image generation and extract context
   */
  private async detectImageRetryContext(message: BotMessage, context: PluginContext): Promise<string | null> {
    // Check if this message is a reply
    if (!message.replyToId) return null;

    try {
      // First try to get from database (direct lookup by platform message ID)
      const repliedMessage = getMessageByPlatformId(message.platform, message.replyToId);
      let content: string | undefined = repliedMessage?.is_bot ? repliedMessage.content : undefined;

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
      let resolved = false;

      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve(null);
        }
      }, 5000);

      context.eventBus.emit('message:fetch', {
        channelId,
        messageId,
        platform: platform as 'discord' | 'slack',
        callback: (content: string | null) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            resolve(content);
          }
        },
      });
    });
  }

  /**
   * Build context about user's configured webhooks for image routing
   */
  private buildWebhookContext(message: BotMessage): string | null {
    try {
      // Get user's internal ID
      const dbUser = getUserByPlatformId(message.platform, message.author.id);
      if (!dbUser) return null;

      // Get user's webhooks (works independently of API key)
      const webhooks = getUserWebhooks(dbUser.id);
      if (webhooks.length === 0) return null;

      // Build webhook category list
      const allCategories = new Set<string>();
      const webhookDescriptions: string[] = [];

      for (const webhook of webhooks) {
        if (webhook.categories.length > 0) {
          for (const c of webhook.categories) {
            allCategories.add(c);
          }
          webhookDescriptions.push(
            `- "${webhook.name}": categories [${webhook.categories.join(', ')}]${webhook.isDefault ? ' (default)' : ''}`,
          );
        } else if (webhook.isDefault) {
          webhookDescriptions.push(`- "${webhook.name}": default webhook (no specific categories)`);
        }
      }

      if (allCategories.size === 0 && webhookDescriptions.length === 0) return null;

      const lines = [
        '## Image Webhooks',
        'This user has configured webhooks for image routing. When generating images that match these categories, use the webhook parameters:',
        '',
        '**Configured webhooks:**',
        ...webhookDescriptions,
        '',
        `**Available categories:** ${[...allCategories].join(', ') || '(none - use default webhook)'}`,
        '',
        '**Usage:** When generating an image that fits a category (e.g., nsfw content), set `webhookSend: true` and `webhookCategory: "<category>"` in the image_generation tool call.',
        'If no category matches but a default webhook exists, set `webhookSend: true` without a category.',
      ];

      return lines.join('\n');
    } catch {
      return null;
    }
  }
}
