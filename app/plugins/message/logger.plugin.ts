/**
 * Logger Plugin - Logs all messages and generates embeddings
 *
 * This plugin:
 * 1. Logs messages to the terminal for visibility (with role groups)
 * 2. Stores messages in the database (with user upsert)
 * 3. Generates embeddings for semantic search
 * 4. Caches user role → group mappings
 *
 * Scope: 'all' - processes every message, not just mentions
 */

import type { BotConfig, BotMessage, MessageHandlerPlugin, PluginContext } from '@core';
import {
  formatGroupsForLog,
  getOrRefreshUserRoles,
  getUserByPlatformId,
  insertMessage,
  messageExists,
  updateMessageEmbedding,
} from '../../../core/database';
import { embed, isEmbedderReady } from '../../../core/embedder';

export class LoggerPlugin implements MessageHandlerPlugin {
  readonly id = 'logger';
  readonly type = 'message' as const;
  readonly scope = 'all' as const; // Process ALL messages
  readonly priority = 100; // Run first, before other handlers

  private context?: PluginContext;
  private config?: BotConfig;

  async load(context: PluginContext): Promise<void> {
    this.context = context;
    this.config = context.config;
    // Embedder is initialized at startup by discord command
    // Just verify it's ready
    if (isEmbedderReady()) {
      context.logger.info('LoggerPlugin: Embedding model ready');
    } else {
      context.logger.warn('LoggerPlugin: Embedding model not initialized - embeddings will be skipped');
    }
    context.logger.info('LoggerPlugin loaded');
  }

  async unload(): Promise<void> {
    this.context?.logger.info('LoggerPlugin unloaded');
    this.context = undefined;
    this.config = undefined;
  }

  shouldHandle(_message: BotMessage): boolean {
    // Handle all messages
    return true;
  }

  async handle(message: BotMessage, context: PluginContext): Promise<void> {
    // 1. Resolve and cache user role groups (if guild message with roles)
    let groups: string[] = ['everyone'];
    if (message.guildId && message.author.roleIds && message.author.roleIds.length > 0) {
      // Get user DB ID for caching
      const user = getUserByPlatformId(message.platform, message.author.id);
      if (user) {
        const userRoles = getOrRefreshUserRoles(
          {
            userId: user.id,
            guildId: message.guildId,
            platform: message.platform,
            roleIds: message.author.roleIds,
          },
          this.config,
        );
        groups = userRoles.resolvedGroups;
      }
    }

    // 2. Log to terminal (with groups)
    this.logToTerminal(message, groups);

    // 3. Skip if message already exists (e.g., edited messages re-firing)
    if (messageExists(message.platform, message.id)) {
      context.logger.debug('LoggerPlugin: Message already exists', { id: message.id });
      return;
    }

    // 4. Store in database (also upserts user)
    try {
      const messageId = insertMessage({
        platform: message.platform,
        platformMessageId: message.id,
        guildId: message.guildId,
        channelId: message.channel.id,
        platformUserId: message.author.id,
        username: message.author.name,
        displayName: message.author.displayName,
        avatarUrl: message.author.avatarUrl,
        isBot: message.author.isBot,
        content: message.content,
        timestamp: message.timestamp,
      });
      context.logger.debug('LoggerPlugin: Stored message', { id: message.id, dbId: messageId });

      // 5. Generate embedding (skip for very short messages or bot messages)
      if (message.content.length >= 3 && !message.author.isBot) {
        if (isEmbedderReady()) {
          const embedding = await embed(message.content);
          updateMessageEmbedding(messageId, embedding);
          context.logger.debug('LoggerPlugin: Generated embedding', { id: message.id });
        }
      }
    } catch (error) {
      context.logger.error('LoggerPlugin: Failed to store message', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Log message to terminal in a readable format
   */
  private logToTerminal(message: BotMessage, groups: string[]): void {
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
    const platform = message.platform.charAt(0).toUpperCase() + message.platform.slice(1);
    const guild = message.guildId ? (message.guildName ?? message.guildId) : 'DM';
    const channel = message.channel.name ?? message.channel.id;
    const user = message.author.displayName ?? message.author.name;
    const bot = message.author.isBot ? ' [BOT]' : '';
    const groupLabel = message.author.isBot ? '' : ` [${formatGroupsForLog(groups)}]`;

    // Truncate long messages for terminal display
    const content = message.content.length > 200 ? `${message.content.substring(0, 200)}...` : message.content;

    // Format: [HH:MM:SS] [Platform] Guild/#channel | User [groups]: message
    console.log(`[${timestamp}] [${platform}] ${guild}/#${channel} | ${user}${bot}${groupLabel}: ${content}`);
  }
}

export default LoggerPlugin;
