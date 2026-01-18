import type { BotConfig, BotMessage, ChatMessage, ContentPart, PluginContext, Tool } from '@core';
import { getBotConfig } from '@core';
import { getRecentMessages } from '@core/database';
import { buildFullSystemPrompt } from '../../../helpers/prompt-builder';
import type { ImageProcessor } from './image-processor';

/** Number of recent messages to include in conversation history */
const HISTORY_LIMIT = 5;

export class ConversationService {
  constructor(
    private config: BotConfig | undefined,
    private imageProcessor: ImageProcessor,
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

    // Build system prompt with all context using centralized helper
    const { systemPrompt, debug } = await buildFullSystemPrompt(config, {
      messageContent: message.content,
      platform: message.platform,
      guildId: message.guildId,
      channelId: message.channel.id,
      userId: message.author.id,
      userName: message.author.displayName ?? message.author.name,
      tools: tools.length > 0 ? tools : undefined,
      channelHistory: channelHistory || undefined,
      additionalContext:
        [imageRetryContext, imageContext].filter((part): part is string => Boolean(part)).join('\n\n') || undefined,
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

    try {
      // Get recent messages from database (excluding current message)
      const recentMessages = getRecentMessages(currentMessage.channel.id, HISTORY_LIMIT + 1);

      // Filter out the current message and reverse to chronological order
      const history = recentMessages
        .filter((m) => m.platform_message_id !== currentMessage.id)
        .slice(0, HISTORY_LIMIT)
        .reverse();

      if (history.length === 0) return null;

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
    } catch (error) {
      console.error('[ConversationService] Channel history fetch error:', error);
      return null;
    }
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
}
