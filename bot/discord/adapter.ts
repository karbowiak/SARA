/**
 * Discord Adapter - Translates Discord events to platform-agnostic events
 */

import type {
  AutocompleteRequest,
  BotChannel,
  BotConfig,
  BotEmbed,
  BotMessage,
  BotUser,
  ButtonInteraction,
  CommandInvocation,
  CommandResponse,
  EventBus,
  FeatureAccess,
  Logger,
  ModalSubmitInteraction,
  SelectMenuInteraction,
} from '@core';
import { checkAccess, getCommandRegistry } from '@core';
import {
  type ActionRowBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  Client,
  type ButtonInteraction as DiscordButtonInteraction,
  type ModalSubmitInteraction as DiscordModalSubmitInteraction,
  Events,
  GatewayIntentBits,
  type Guild,
  type Interaction,
  type Message,
  type MessageActionRowComponentBuilder,
  MessageFlags,
  type StringSelectMenuInteraction,
  type User,
} from 'discord.js';

export interface DiscordAdapterOptions {
  token: string;
  eventBus: EventBus;
  logger: Logger;
  config?: BotConfig;
  /** Access config for plugins (plugin ID → access rules) */
  pluginAccess?: Map<string, FeatureAccess>;
}

/**
 * Discord platform adapter
 *
 * Converts Discord.js events to normalized events and vice versa.
 */
export class DiscordAdapter {
  private client: Client;
  private eventBus: EventBus;
  private logger: Logger;
  private config?: BotConfig;
  private pluginAccess: Map<string, FeatureAccess>;
  private guildUploadLimits: Map<string, number> = new Map();
  private userDirectoryByGuild: Map<string, Map<string, Set<string>>> = new Map();
  private userAliasesByGuild: Map<string, Map<string, Set<string>>> = new Map();
  private userGuilds: Map<string, Set<string>> = new Map();
  private userNameIndex: Map<string, { username?: string; globalName?: string }> = new Map();
  private userRefreshTimer?: NodeJS.Timeout;

  constructor(options: DiscordAdapterOptions) {
    this.eventBus = options.eventBus;
    this.logger = options.logger;
    this.config = options.config;
    this.pluginAccess = options.pluginAccess ?? new Map();

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMembers,
      ],
    });

    this.setupIncomingEvents();
    this.setupOutgoingEvents();
  }

  /**
   * Connect to Discord
   */
  async connect(token: string): Promise<void> {
    this.logger.info('Discord adapter connecting...');

    await this.client.login(token);
  }

  /**
   * Disconnect from Discord
   */
  async disconnect(): Promise<void> {
    this.logger.info('Discord adapter disconnecting...');
    if (this.userRefreshTimer) {
      clearInterval(this.userRefreshTimer);
      this.userRefreshTimer = undefined;
    }
    this.client.destroy();
  }

  /**
   * Get the Discord client (for advanced use)
   */
  getClient(): Client {
    return this.client;
  }

  /**
   * Get upload limit for a guild in bytes
   */
  getGuildUploadLimit(guildId: string): number {
    return this.guildUploadLimits.get(guildId) ?? 10 * 1024 * 1024; // Default 10MB
  }

  /**
   * Cache upload limit based on boost tier
   */
  private cacheGuildUploadLimit(guildId: string, premiumTier: number): void {
    const limits = {
      0: 10 * 1024 * 1024, // 10MB (no boost)
      1: 10 * 1024 * 1024, // 10MB (tier 1 doesn't increase file limit)
      2: 50 * 1024 * 1024, // 50MB (tier 2)
      3: 100 * 1024 * 1024, // 100MB (tier 3)
    };
    const limit = limits[premiumTier as keyof typeof limits] ?? limits[0];
    this.guildUploadLimits.set(guildId, limit);
    this.logger.debug(`Cached upload limit for guild ${guildId}: ${limit / 1024 / 1024}MB (tier ${premiumTier})`);
  }

  // ============================================
  // Guild Whitelist
  // ============================================

  /**
   * Check if a guild is allowed based on whitelist config
   */
  private isGuildAllowed(guildId: string): boolean {
    const whitelist = this.config?.guilds?.whitelist;
    if (!whitelist || whitelist.length === 0) return true; // No whitelist = all allowed
    return whitelist.includes(guildId);
  }

  /**
   * Leave an unauthorized guild, optionally sending a message first
   */
  private async leaveUnauthorizedGuild(guild: Guild): Promise<void> {
    this.logger.warn(`Leaving unauthorized guild: ${guild.name} (${guild.id})`);

    // Try to send message to first available text channel
    const messages = this.config?.guilds?.unauthorizedMessages;
    if (messages) {
      // Pick a random message if array, otherwise use the single string
      const messageText = Array.isArray(messages) ? messages[Math.floor(Math.random() * messages.length)] : messages;

      if (!messageText) return; // Skip if no message

      for (const [, channel] of guild.channels.cache) {
        if (channel.isTextBased() && 'send' in channel) {
          try {
            await channel.send(messageText);
            break;
          } catch {
            // Ignore errors - we might not have permission
          }
        }
      }
    }

    try {
      await guild.leave();
      this.logger.info(`Left unauthorized guild: ${guild.name} (${guild.id})`);
    } catch (error) {
      this.logger.error(`Failed to leave guild: ${guild.name} (${guild.id})`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Check all cached guilds and leave unauthorized ones
   */
  private async enforceGuildWhitelist(): Promise<void> {
    const whitelist = this.config?.guilds?.whitelist;
    if (!whitelist || whitelist.length === 0) {
      this.logger.debug('No guild whitelist configured, all guilds allowed');
      return;
    }

    for (const [guildId, guild] of this.client.guilds.cache) {
      if (!this.isGuildAllowed(guildId)) {
        await this.leaveUnauthorizedGuild(guild);
      }
    }
  }

  // ============================================
  // Incoming Events (Discord → EventBus)
  // ============================================

  private setupIncomingEvents(): void {
    // Ready
    this.client.once(Events.ClientReady, async (client) => {
      this.logger.info(`Discord connected as ${client.user.tag}`);

      // Enforce guild whitelist first (leave unauthorized guilds)
      await this.enforceGuildWhitelist();

      // Cache upload limits for all remaining guilds
      for (const [guildId, guild] of client.guilds.cache) {
        this.cacheGuildUploadLimit(guildId, guild.premiumTier);
      }

      // Build user directory cache and start refresh timer
      this.refreshUserDirectory().catch((error) => {
        this.logger.error('Failed to build user directory', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
      this.startUserRefreshTimer();

      this.eventBus.fire('bot:ready', { platform: 'discord' });
    });

    // Guild member added
    this.client.on(Events.GuildMemberAdd, (member) => {
      this.upsertMemberAliases(member.guild.id, member.user.id, {
        username: member.user.username,
        globalName: member.user.globalName ?? undefined,
        displayName: member.displayName,
      });
    });

    // Guild member updated (nickname change, etc.)
    this.client.on(Events.GuildMemberUpdate, (_, member) => {
      this.upsertMemberAliases(member.guild.id, member.user.id, {
        username: member.user.username,
        globalName: member.user.globalName ?? undefined,
        displayName: member.displayName,
      });
    });

    // Guild member removed
    this.client.on(Events.GuildMemberRemove, (member) => {
      this.removeMemberAliases(member.guild.id, member.user.id);
    });

    // User updated (username/global name)
    this.client.on(Events.UserUpdate, (oldUser, newUser) => {
      const prev = { username: oldUser.username ?? undefined, globalName: oldUser.globalName ?? undefined };
      const next = { username: newUser.username ?? undefined, globalName: newUser.globalName ?? undefined };
      this.updateUserNamesAcrossGuilds(newUser.id, prev, next);
    });

    // Guild joined - check whitelist and cache upload limit
    this.client.on(Events.GuildCreate, async (guild) => {
      // Check whitelist first
      if (!this.isGuildAllowed(guild.id)) {
        await this.leaveUnauthorizedGuild(guild);
        return;
      }

      this.cacheGuildUploadLimit(guild.id, guild.premiumTier);
      this.logger.info(`Joined guild: ${guild.name} (${guild.id})`);
    });

    // Message received
    this.client.on(Events.MessageCreate, (message) => {
      // Ignore own messages
      if (message.author.id === this.client.user?.id) return;
      // Extra safety: ignore all bot messages
      if (message.author.bot) return;

      this.eventBus.fire('message:received', this.transformMessage(message));
    });

    // Message updated
    this.client.on(Events.MessageUpdate, (_old, newMessage) => {
      if (newMessage.partial) return;
      if (newMessage.author?.id === this.client.user?.id) return;

      this.eventBus.fire('message:updated', this.transformMessage(newMessage as Message));
    });

    // Message deleted
    this.client.on(Events.MessageDelete, (message) => {
      this.eventBus.fire('message:deleted', {
        messageId: message.id,
        channelId: message.channelId,
        platform: 'discord',
      });
    });

    // Reaction added
    this.client.on(Events.MessageReactionAdd, (reaction, user) => {
      if (user.bot) return;

      this.eventBus.fire('reaction:added', {
        messageId: reaction.message.id,
        channelId: reaction.message.channelId,
        emoji: reaction.emoji.name ?? reaction.emoji.id ?? '❓',
        userId: user.id,
        platform: 'discord',
      });
    });

    // Reaction removed
    this.client.on(Events.MessageReactionRemove, (reaction, user) => {
      this.eventBus.fire('reaction:removed', {
        messageId: reaction.message.id,
        channelId: reaction.message.channelId,
        emoji: reaction.emoji.name ?? reaction.emoji.id ?? '❓',
        userId: user.id,
        platform: 'discord',
      });
    });

    // Interaction events (slash commands, buttons, etc.)
    this.client.on(Events.InteractionCreate, (interaction) => {
      this.handleInteraction(interaction);
    });

    // Error handling
    this.client.on(Events.Error, (error) => {
      this.logger.error('Discord client error', { error: error.message });
      this.eventBus.fire('bot:error', { error, context: 'discord' });
    });
  }

  // ============================================
  // Outgoing Events (EventBus → Discord)
  // ============================================

  private setupOutgoingEvents(): void {
    // Track active typing per channel with reference counting
    const typingState = new Map<string, { count: number; interval: NodeJS.Timeout }>();

    // Send message
    this.eventBus.on('message:send', async (request) => {
      if (request.platform !== 'discord') return;

      try {
        const channel = await this.client.channels.fetch(request.channelId);
        if (!channel?.isTextBased() || !('send' in channel)) {
          this.logger.warn('Cannot send to non-text channel', { channelId: request.channelId });
          return;
        }

        // Build Discord message options
        const messageOptions: {
          content?: string;
          reply?: { messageReference: string };
          files?: Array<{ attachment: Buffer | string; name: string }>;
          embeds?: any[];
          components?: any[];
        } = {};

        if (request.message.content) {
          messageOptions.content = request.message.content;
        }

        if (request.message.replyToId) {
          messageOptions.reply = { messageReference: request.message.replyToId };
        }

        // Handle file attachments
        if (request.message.attachments && request.message.attachments.length > 0) {
          messageOptions.files = request.message.attachments.map((att) => ({
            attachment: att.data,
            name: att.filename,
          }));
        }

        // Handle embeds
        if (request.message.embeds && request.message.embeds.length > 0) {
          messageOptions.embeds = request.message.embeds.map((e) => this.transformEmbed(e));
        }

        // Handle components (buttons, selects)
        if (request.message.components && request.message.components.length > 0) {
          messageOptions.components = this.transformComponents(request.message.components);
        }

        await channel.send(messageOptions);

        // Log outgoing message to terminal
        this.logOutgoingMessage(channel, request.message.content, request.message.attachments?.length);
      } catch (error) {
        this.logger.error('Failed to send message', {
          channelId: request.channelId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    // Suppress embeds on a message
    this.eventBus.on('message:suppress-embeds', async (request) => {
      if (request.platform !== 'discord') return;

      try {
        const channel = await this.client.channels.fetch(request.channelId);
        if (!channel?.isTextBased()) return;

        const message = await (channel as any).messages.fetch(request.messageId);
        if (message?.flags) {
          await message.suppressEmbeds(true);
        }
      } catch (error) {
        this.logger.debug('Failed to suppress embeds', {
          messageId: request.messageId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    // Start typing indicator (reference counted)
    this.eventBus.on('typing:start', async (request) => {
      if (request.platform !== 'discord') return;

      const existing = typingState.get(request.channelId);
      if (existing) {
        // Already typing in this channel, just increment count
        existing.count++;
        return;
      }

      try {
        const channel = await this.client.channels.fetch(request.channelId);
        if (!channel?.isTextBased() || !('sendTyping' in channel)) return;

        // Send initial typing
        await channel.sendTyping();

        // Set up interval to keep typing indicator alive (Discord timeout is ~10s)
        const interval = setInterval(async () => {
          try {
            if ('sendTyping' in channel) {
              await channel.sendTyping();
            }
          } catch {
            // Ignore errors refreshing typing
          }
        }, 8000);

        // Store with count of 1
        typingState.set(request.channelId, { count: 1, interval });
      } catch (error) {
        this.logger.error('Failed to start typing', {
          channelId: request.channelId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    // Stop typing indicator (reference counted)
    this.eventBus.on('typing:stop', (request) => {
      if (request.platform !== 'discord') return;

      const state = typingState.get(request.channelId);
      if (!state) return;

      state.count--;

      // Only clear interval when all requests are done
      if (state.count <= 0) {
        clearInterval(state.interval);
        typingState.delete(request.channelId);
      }
    });

    // Add reaction
    this.eventBus.on('reaction:add', async (reaction) => {
      if (reaction.platform !== 'discord') return;

      try {
        const channel = await this.client.channels.fetch(reaction.channelId);
        if (!channel?.isTextBased()) return;

        const message = await channel.messages.fetch(reaction.messageId);
        await message.react(reaction.emoji);
      } catch (error) {
        this.logger.error('Failed to add reaction', {
          messageId: reaction.messageId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    // Fetch message content
    this.eventBus.on('message:fetch', async (request) => {
      if (request.platform !== 'discord') return;

      try {
        const channel = await this.client.channels.fetch(request.channelId);
        if (!channel?.isTextBased() || !('messages' in channel)) {
          request.callback(null);
          return;
        }

        const message = await channel.messages.fetch(request.messageId);
        request.callback(message.content);
      } catch (error) {
        this.logger.debug('Failed to fetch message', {
          messageId: request.messageId,
          error: error instanceof Error ? error.message : String(error),
        });
        request.callback(null);
      }
    });

    // Resolve @name to user ID using cached directory
    this.eventBus.on('user:resolve', async (request) => {
      if (request.platform !== 'discord') return;

      const resolved = this.resolveUserId(request.name, request.guildId);
      request.callback(resolved);
    });

    // Send DM to a user
    this.eventBus.on('dm:send', async (request) => {
      if (request.platform !== 'discord') return;

      try {
        const user = await this.client.users.fetch(request.userId);
        const dmChannel = await user.createDM();

        // Build message options
        const messageOptions: {
          content?: string;
          files?: Array<{ attachment: Buffer | string; name: string }>;
          components?: ActionRowBuilder<MessageActionRowComponentBuilder>[];
        } = {};

        if (request.message.content) {
          messageOptions.content = request.message.content;
        }

        if (request.message.attachments && request.message.attachments.length > 0) {
          messageOptions.files = request.message.attachments.map((att) => ({
            attachment: att.data,
            name: att.filename,
          }));
        }

        if (request.message.components && request.message.components.length > 0) {
          messageOptions.components = this.transformComponents(
            request.message.components,
          ) as ActionRowBuilder<MessageActionRowComponentBuilder>[];
        }

        await dmChannel.send(messageOptions);

        // Log outgoing DM
        this.logOutgoingDM(user.username, request.message.content);
      } catch (error) {
        this.logger.error('Failed to send DM', {
          userId: request.userId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }

  // ============================================
  // User Directory Cache
  // ============================================

  private normalizeName(name?: string | null): string | null {
    if (!name) return null;
    const normalized = name.trim().toLowerCase();
    return normalized.length > 0 ? normalized : null;
  }

  private getGuildDirectory(guildId: string): Map<string, Set<string>> {
    let directory = this.userDirectoryByGuild.get(guildId);
    if (!directory) {
      directory = new Map();
      this.userDirectoryByGuild.set(guildId, directory);
    }
    return directory;
  }

  private getGuildAliases(guildId: string): Map<string, Set<string>> {
    let aliases = this.userAliasesByGuild.get(guildId);
    if (!aliases) {
      aliases = new Map();
      this.userAliasesByGuild.set(guildId, aliases);
    }
    return aliases;
  }

  private upsertMemberAliases(
    guildId: string,
    userId: string,
    names: { username?: string; globalName?: string; displayName?: string },
  ): void {
    const directory = this.getGuildDirectory(guildId);
    const aliasesByUser = this.getGuildAliases(guildId);

    // Remove old aliases for this user
    const previous = aliasesByUser.get(userId);
    if (previous) {
      for (const alias of previous) {
        const set = directory.get(alias);
        if (set) {
          set.delete(userId);
          if (set.size === 0) directory.delete(alias);
        }
      }
    }

    const aliases = new Set<string>();
    const candidateNames = [names.username, names.globalName, names.displayName]
      .map((n) => this.normalizeName(n))
      .filter((n): n is string => Boolean(n));

    for (const alias of candidateNames) {
      aliases.add(alias);
      const set = directory.get(alias) ?? new Set<string>();
      set.add(userId);
      directory.set(alias, set);
    }

    aliasesByUser.set(userId, aliases);

    // Track guild membership for user update events
    const userGuildSet = this.userGuilds.get(userId) ?? new Set<string>();
    userGuildSet.add(guildId);
    this.userGuilds.set(userId, userGuildSet);

    if (names.username || names.globalName) {
      this.userNameIndex.set(userId, { username: names.username, globalName: names.globalName });
    }
  }

  private removeMemberAliases(guildId: string, userId: string): void {
    const directory = this.getGuildDirectory(guildId);
    const aliasesByUser = this.getGuildAliases(guildId);
    const aliases = aliasesByUser.get(userId);
    if (!aliases) return;

    for (const alias of aliases) {
      const set = directory.get(alias);
      if (set) {
        set.delete(userId);
        if (set.size === 0) directory.delete(alias);
      }
    }

    aliasesByUser.delete(userId);

    const userGuildSet = this.userGuilds.get(userId);
    if (userGuildSet) {
      userGuildSet.delete(guildId);
      if (userGuildSet.size === 0) {
        this.userGuilds.delete(userId);
        this.userNameIndex.delete(userId);
      }
    }
  }

  private updateUserNamesAcrossGuilds(
    userId: string,
    previous: { username?: string; globalName?: string },
    next: { username?: string; globalName?: string },
  ): void {
    const guilds = this.userGuilds.get(userId);
    if (!guilds || guilds.size === 0) return;

    for (const guildId of guilds) {
      const directory = this.getGuildDirectory(guildId);
      const aliasesByUser = this.getGuildAliases(guildId);
      const aliases = aliasesByUser.get(userId);
      if (!aliases) continue;

      const prevNames = [previous.username, previous.globalName]
        .map((n) => this.normalizeName(n))
        .filter((n): n is string => Boolean(n));
      const nextNames = [next.username, next.globalName]
        .map((n) => this.normalizeName(n))
        .filter((n): n is string => Boolean(n));

      // Remove old username/globalName aliases
      for (const name of prevNames) {
        if (aliases.has(name)) {
          aliases.delete(name);
          const set = directory.get(name);
          if (set) {
            set.delete(userId);
            if (set.size === 0) directory.delete(name);
          }
        }
      }

      // Add new username/globalName aliases
      for (const name of nextNames) {
        if (!aliases.has(name)) {
          aliases.add(name);
          const set = directory.get(name) ?? new Set<string>();
          set.add(userId);
          directory.set(name, set);
        }
      }

      aliasesByUser.set(userId, aliases);
    }

    this.userNameIndex.set(userId, { username: next.username, globalName: next.globalName });
  }

  private async refreshUserDirectory(): Promise<void> {
    try {
      await this.client.guilds.fetch();
      this.userDirectoryByGuild.clear();
      this.userAliasesByGuild.clear();
      this.userGuilds.clear();
      this.userNameIndex.clear();

      for (const [, guild] of this.client.guilds.cache) {
        try {
          const members = await guild.members.fetch();
          for (const [, member] of members) {
            this.upsertMemberAliases(guild.id, member.user.id, {
              username: member.user.username,
              globalName: member.user.globalName ?? undefined,
              displayName: member.displayName,
            });
          }
        } catch (error) {
          this.logger.warn('Failed to fetch guild members', {
            guildId: guild.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      this.logger.info('Discord user directory refreshed', {
        guilds: this.client.guilds.cache.size,
        totalUsers: this.userGuilds.size,
        totalGuildDirectories: this.userDirectoryByGuild.size,
        userNameIndexSize: this.userNameIndex.size,
      });
    } catch (error) {
      this.logger.error('Failed to refresh Discord user directory', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private startUserRefreshTimer(): void {
    if (this.userRefreshTimer) return;
    const twelveHoursMs = 12 * 60 * 60 * 1000;
    this.userRefreshTimer = setInterval(() => {
      this.refreshUserDirectory().catch(() => {});
    }, twelveHoursMs);

    // Log cache stats periodically (every 5 minutes)
    setInterval(
      () => {
        const stats = {
          totalUsers: this.userGuilds.size,
          totalGuildDirectories: this.userDirectoryByGuild.size,
          userNameIndexSize: this.userNameIndex.size,
          guildUploadLimitCache: this.guildUploadLimits.size,
        };
        this.logger.debug('[DiscordAdapter] User directory cache stats', stats);
      },
      5 * 60 * 1000,
    );
  }

  private resolveUserId(name: string, guildId?: string): string | null {
    if (!guildId) return null;
    const normalized = this.normalizeName(name);
    if (!normalized) return null;

    const directory = this.getGuildDirectory(guildId);
    const matches = directory.get(normalized);
    if (!matches || matches.size !== 1) return null;

    return matches.values().next().value ?? null;
  }

  // ============================================
  // Transformers
  // ============================================

  private transformMessage(message: Message): BotMessage {
    const botId = this.client.user?.id;
    // In DMs (no guild), always respond. In channels, require @mention or reply to bot
    const isDM = !message.guildId;
    const isDirectMention = botId
      ? message.mentions.users.has(botId) || message.content.includes(`<@${botId}>`)
      : false;
    // Check if this is a reply to the bot's message
    const isReplyToBot = message.reference?.messageId && message.mentions.repliedUser?.id === botId;
    const mentionedBot = isDM || isDirectMention || isReplyToBot;

    // Get author's role IDs from guild member
    const authorRoleIds = message.member?.roles.cache.map((r) => r.id);

    return {
      id: message.id,
      content: message.content,
      author: this.transformUser(message.author, authorRoleIds),
      channel: this.transformChannel(message),
      attachments: message.attachments.map((a) => ({
        id: a.id,
        filename: a.name,
        url: a.url,
        proxyUrl: a.proxyURL,
        contentType: a.contentType ?? undefined,
        size: a.size,
      })),
      embeds: message.embeds.map((e) => ({
        title: e.title ?? undefined,
        description: e.description ?? undefined,
        url: e.url ?? undefined,
        color: e.color ?? undefined,
        timestamp: e.timestamp ? new Date(e.timestamp) : undefined,
        footer: e.footer ? { text: e.footer.text, iconUrl: e.footer.iconURL ?? undefined } : undefined,
        thumbnail: e.thumbnail ? { url: e.thumbnail.proxyURL || e.thumbnail.url } : undefined,
        image: e.image ? { url: e.image.proxyURL || e.image.url } : undefined,
        author: e.author
          ? { name: e.author.name, url: e.author.url ?? undefined, iconUrl: e.author.iconURL ?? undefined }
          : undefined,
        fields: e.fields?.map((f) => ({ name: f.name, value: f.value, inline: f.inline })),
      })),
      guildId: message.guildId ?? undefined,
      guildName: message.guild?.name ?? undefined,
      mentionedUserIds: message.mentions.users.map((u) => u.id),
      mentionedUsers: message.mentions.users.map((u) => this.transformUser(u)),
      mentionedBot,
      replyToId: message.reference?.messageId ?? undefined,
      threadId: undefined, // Discord threads have their own channel ID, no need for threadId
      timestamp: message.createdAt,
      platform: 'discord',
      raw: message,
    };
  }

  private transformUser(user: User, roleIds?: string[]): BotUser {
    return {
      id: user.id,
      name: user.username,
      displayName: user.displayName ?? user.username,
      isBot: user.bot,
      avatarUrl: user.displayAvatarURL(),
      roleIds,
    };
  }

  private transformChannel(message: Message): BotChannel {
    const channel = message.channel;

    return {
      id: channel.id,
      name: 'name' in channel ? (channel.name ?? undefined) : undefined,
      type: message.guildId ? 'guild' : 'dm',
      topic: 'topic' in channel ? (channel.topic ?? undefined) : undefined,
    };
  }

  /**
   * Log outgoing bot message to terminal in same format as incoming messages
   */
  private logOutgoingMessage(
    channel: { id: string; guild?: { name: string } | null } & { name?: string },
    content?: string,
    attachmentCount?: number,
  ): void {
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
    const guild = channel.guild?.name ?? 'DM';
    const channelName = channel.name ?? channel.id;
    const botName = this.config?.bot.name ?? 'Bot';

    // Truncate long messages for terminal display
    let displayContent = content ?? '';
    if (displayContent.length > 200) {
      displayContent = `${displayContent.substring(0, 200)}...`;
    }

    // Add attachment indicator
    if (attachmentCount && attachmentCount > 0) {
      displayContent = displayContent
        ? `${displayContent} [${attachmentCount} attachment(s)]`
        : `[${attachmentCount} attachment(s)]`;
    }

    // ANSI colors (matching logger.plugin.ts)
    const dim = '\x1b[2m';
    const reset = '\x1b[0m';
    const yellow = '\x1b[33m';
    const blue = '\x1b[34m';
    const magenta = '\x1b[35m';
    const white = '\x1b[37m';

    // Format: [HH:MM:SS] Guild/#channel │ BotName [BOT]: message
    console.log(
      `${dim}[${timestamp}]${reset} ` +
        `${yellow}${guild}${reset}${dim}/${reset}${blue}#${channelName}${reset} ` +
        `${dim}│${reset} ${magenta}${botName}${reset} ${magenta}[BOT]${reset}` +
        `${dim}:${reset} ${white}${displayContent}${reset}`,
    );
  }

  /**
   * Log outgoing DM to terminal
   */
  private logOutgoingDM(username: string, content?: string): void {
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
    const botName = this.config?.bot.name ?? 'Bot';

    // Truncate long messages for terminal display
    let displayContent = content ?? '';
    if (displayContent.length > 200) {
      displayContent = `${displayContent.substring(0, 200)}...`;
    }

    // ANSI colors
    const dim = '\x1b[2m';
    const reset = '\x1b[0m';
    const cyan = '\x1b[36m';
    const magenta = '\x1b[35m';
    const white = '\x1b[37m';

    // Format: [HH:MM:SS] DM → @username │ BotName [BOT]: message
    console.log(
      `${dim}[${timestamp}]${reset} ` +
        `${magenta}DM${reset} ${dim}→${reset} ${cyan}@${username}${reset} ` +
        `${dim}│${reset} ${magenta}${botName}${reset} ${magenta}[BOT]${reset}` +
        `${dim}:${reset} ${white}${displayContent}${reset}`,
    );
  }

  // ============================================
  // Interaction Handling
  // ============================================

  private handleInteraction(interaction: Interaction): void {
    if (interaction.isChatInputCommand()) {
      this.handleSlashCommand(interaction);
    } else if (interaction.isAutocomplete()) {
      this.handleAutocomplete(interaction);
    } else if (interaction.isButton()) {
      this.handleButton(interaction);
    } else if (interaction.isStringSelectMenu()) {
      this.handleSelectMenu(interaction);
    } else if (interaction.isModalSubmit()) {
      this.handleModalSubmit(interaction);
    }
  }

  private handleSlashCommand(interaction: ChatInputCommandInteraction): void {
    // Extract subcommand info
    const subcommandGroup = interaction.options.getSubcommandGroup(false);
    const subcommand = interaction.options.getSubcommand(false);

    // Extract all options
    const args: Record<string, unknown> = {};
    for (const option of interaction.options.data) {
      if (option.type === 1 || option.type === 2) {
        // Subcommand or SubcommandGroup - extract nested options
        for (const subOption of option.options ?? []) {
          args[subOption.name] = subOption.value;
        }
      } else {
        args[option.name] = option.value;
      }
    }

    const invocation: CommandInvocation = {
      commandName: interaction.commandName,
      subcommand: subcommand ?? undefined,
      subcommandGroup: subcommandGroup ?? undefined,
      args,
      user: {
        id: interaction.user.id,
        name: interaction.user.username,
        displayName: interaction.user.displayName ?? interaction.user.username,
        isBot: interaction.user.bot,
        avatarUrl: interaction.user.displayAvatarURL(),
      },
      channel: {
        id: interaction.channelId,
        name:
          interaction.channel && 'name' in interaction.channel ? (interaction.channel.name ?? undefined) : undefined,
        type: interaction.guildId ? 'guild' : 'dm',
        nsfw: interaction.channel && 'nsfw' in interaction.channel ? (interaction.channel.nsfw ?? false) : false,
        topic:
          interaction.channel && 'topic' in interaction.channel ? (interaction.channel.topic ?? undefined) : undefined,
      },
      guildId: interaction.guildId ?? undefined,
      platform: 'discord',
      raw: interaction,
      reply: async (response: CommandResponse) => {
        await interaction.reply({
          content: response.content,
          embeds: response.embeds?.map((e) => this.transformEmbed(e)),
          components: response.components ? (this.transformComponents(response.components) as any) : undefined,
          flags: response.ephemeral ? MessageFlags.Ephemeral : undefined,
          files: response.attachments?.map((att) => ({
            attachment: att.data,
            name: att.filename,
          })),
        });
      },
      defer: async (ephemeral?: boolean) => {
        await interaction.deferReply({
          flags: ephemeral ? MessageFlags.Ephemeral : undefined,
        });
      },
      followUp: async (response: CommandResponse) => {
        await interaction.followUp({
          content: response.content,
          embeds: response.embeds?.map((e) => this.transformEmbed(e)),
          components: response.components ? (this.transformComponents(response.components) as any) : undefined,
          flags: response.ephemeral ? MessageFlags.Ephemeral : undefined,
          files: response.attachments?.map((att) => ({
            attachment: att.data,
            name: att.filename,
          })),
        });
      },
      showModal: async (modal) => {
        const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');

        const discordModal = new ModalBuilder().setCustomId(modal.customId).setTitle(modal.title);

        for (const field of modal.fields) {
          const input = new TextInputBuilder()
            .setCustomId(field.customId)
            .setLabel(field.label)
            .setStyle(field.style === 'paragraph' ? TextInputStyle.Paragraph : TextInputStyle.Short)
            .setRequired(field.required ?? true);

          if (field.placeholder) input.setPlaceholder(field.placeholder);
          if (field.value) input.setValue(field.value);
          if (field.minLength) input.setMinLength(field.minLength);
          if (field.maxLength) input.setMaxLength(field.maxLength);

          discordModal.addComponents(new ActionRowBuilder().addComponents(input));
        }

        await interaction.showModal(discordModal);
      },
    };

    // Check access control before emitting event
    const accessConfig = this.pluginAccess.get(interaction.commandName);
    if (accessConfig) {
      // Get user's role IDs from guild member
      const roleIds = interaction.member?.roles
        ? Array.isArray(interaction.member.roles)
          ? interaction.member.roles
          : [...interaction.member.roles.cache.keys()]
        : [];

      const accessContext = {
        platform: 'discord' as const,
        userId: interaction.user.id,
        roleIds,
        guildId: interaction.guildId ?? undefined,
      };

      // Check subcommand-specific access if applicable
      let effectiveAccess = accessConfig;
      if (subcommand && accessConfig.subcommands?.[subcommand]) {
        effectiveAccess = accessConfig.subcommands[subcommand];
      }

      if (!checkAccess(effectiveAccess, accessContext, this.config)) {
        // Deny access with ephemeral message
        const commandPath = subcommand ? `/${interaction.commandName} ${subcommand}` : `/${interaction.commandName}`;
        interaction.reply({
          content: `❌ You do not have permission to use ${commandPath}.`,
          flags: MessageFlags.Ephemeral,
        });
        this.logger.debug(`Access denied for command ${commandPath}`, {
          user: interaction.user.username,
          userId: interaction.user.id,
          guildId: interaction.guildId,
        });
        return;
      }
    }

    this.eventBus.fire('command:received', invocation);
  }

  private handleAutocomplete(interaction: AutocompleteInteraction): void {
    const focused = interaction.options.getFocused(true);

    const request: AutocompleteRequest = {
      commandName: interaction.commandName,
      subcommand: interaction.options.getSubcommand(false) ?? undefined,
      subcommandGroup: interaction.options.getSubcommandGroup(false) ?? undefined,
      focusedOption: {
        name: focused.name,
        value: String(focused.value),
      },
      options: {},
      user: {
        id: interaction.user.id,
        name: interaction.user.username,
        displayName: interaction.user.displayName ?? interaction.user.username,
        isBot: interaction.user.bot,
      },
      channel: {
        id: interaction.channelId,
        name:
          interaction.channel && 'name' in interaction.channel ? (interaction.channel.name ?? undefined) : undefined,
        type: interaction.guildId ? 'guild' : 'dm',
        topic:
          interaction.channel && 'topic' in interaction.channel ? (interaction.channel.topic ?? undefined) : undefined,
      },
      guildId: interaction.guildId ?? undefined,
      platform: 'discord',
      raw: interaction,
      respond: async (choices) => {
        await interaction.respond(choices.slice(0, 25).map((c) => ({ name: c.name, value: String(c.value) })));
      },
    };

    this.eventBus.fire('command:autocomplete', request);
  }

  private handleButton(interaction: DiscordButtonInteraction): void {
    const buttonInteraction: ButtonInteraction = {
      customId: interaction.customId,
      user: {
        id: interaction.user.id,
        name: interaction.user.username,
        displayName: interaction.user.displayName ?? interaction.user.username,
        isBot: interaction.user.bot,
      },
      channel: {
        id: interaction.channelId,
        name:
          interaction.channel && 'name' in interaction.channel ? (interaction.channel.name ?? undefined) : undefined,
        type: interaction.guildId ? 'guild' : 'dm',
        topic:
          interaction.channel && 'topic' in interaction.channel ? (interaction.channel.topic ?? undefined) : undefined,
      },
      messageId: interaction.message.id,
      guildId: interaction.guildId ?? undefined,
      platform: 'discord',
      raw: interaction,
      update: async (response) => {
        await interaction.update({
          content: response.content,
          embeds: response.embeds?.map((e) => this.transformEmbed(e)),
          components: response.components ? (this.transformComponents(response.components) as any) : undefined,
        });
      },
      deferUpdate: async () => {
        await interaction.deferUpdate();
      },
      reply: async (response) => {
        await interaction.reply({
          content: response.content,
          embeds: response.embeds?.map((e) => this.transformEmbed(e)),
          components: response.components ? (this.transformComponents(response.components) as any) : undefined,
          flags: response.ephemeral ? MessageFlags.Ephemeral : undefined,
        });
      },
    };

    this.eventBus.fire('interaction:button', buttonInteraction);
  }

  private handleSelectMenu(interaction: StringSelectMenuInteraction): void {
    const selectInteraction: SelectMenuInteraction = {
      customId: interaction.customId,
      values: interaction.values,
      user: {
        id: interaction.user.id,
        name: interaction.user.username,
        displayName: interaction.user.displayName ?? interaction.user.username,
        isBot: interaction.user.bot,
      },
      channel: {
        id: interaction.channelId,
        name:
          interaction.channel && 'name' in interaction.channel ? (interaction.channel.name ?? undefined) : undefined,
        type: interaction.guildId ? 'guild' : 'dm',
        topic:
          interaction.channel && 'topic' in interaction.channel ? (interaction.channel.topic ?? undefined) : undefined,
      },
      messageId: interaction.message.id,
      guildId: interaction.guildId ?? undefined,
      platform: 'discord',
      raw: interaction,
      update: async (response) => {
        await interaction.update({
          content: response.content,
          embeds: response.embeds?.map((e) => this.transformEmbed(e)),
          components: response.components ? (this.transformComponents(response.components) as any) : undefined,
        });
      },
      deferUpdate: async () => {
        await interaction.deferUpdate();
      },
      reply: async (response) => {
        await interaction.reply({
          content: response.content,
          embeds: response.embeds?.map((e) => this.transformEmbed(e)),
          components: response.components ? (this.transformComponents(response.components) as any) : undefined,
          flags: response.ephemeral ? MessageFlags.Ephemeral : undefined,
        });
      },
    };

    this.eventBus.fire('interaction:select', selectInteraction);
  }

  private handleModalSubmit(interaction: DiscordModalSubmitInteraction): void {
    // Extract field values
    const fields: Record<string, string> = {};
    for (const [key, component] of interaction.fields.fields) {
      if ('value' in component) {
        fields[key] = component.value;
      }
    }

    const modalInteraction: ModalSubmitInteraction = {
      customId: interaction.customId,
      fields,
      user: {
        id: interaction.user.id,
        name: interaction.user.username,
        displayName: interaction.user.displayName ?? interaction.user.username,
        isBot: interaction.user.bot,
      },
      channel: {
        id: interaction.channelId!,
        name:
          interaction.channel && 'name' in interaction.channel ? (interaction.channel.name ?? undefined) : undefined,
        type: interaction.guildId ? 'guild' : 'dm',
        topic:
          interaction.channel && 'topic' in interaction.channel ? (interaction.channel.topic ?? undefined) : undefined,
      },
      guildId: interaction.guildId ?? undefined,
      platform: 'discord',
      raw: interaction,
      reply: async (response) => {
        await interaction.reply({
          content: response.content,
          embeds: response.embeds?.map((e) => this.transformEmbed(e)),
          flags: response.ephemeral ? MessageFlags.Ephemeral : undefined,
        });
      },
      defer: async (ephemeral?: boolean) => {
        await interaction.deferReply({
          flags: ephemeral ? MessageFlags.Ephemeral : undefined,
        });
      },
      followUp: async (response) => {
        await interaction.followUp({
          content: response.content,
          embeds: response.embeds?.map((e) => this.transformEmbed(e)),
          flags: response.ephemeral ? MessageFlags.Ephemeral : undefined,
          files: response.attachments?.map((att) => ({
            attachment: att.data,
            name: att.filename,
          })),
        });
      },
    };

    this.eventBus.fire('interaction:modal', modalInteraction);
  }

  private transformEmbed(embed: BotEmbed): Record<string, unknown> {
    return {
      title: embed.title,
      description: embed.description,
      color: embed.color,
      url: embed.url,
      timestamp: embed.timestamp?.toISOString(),
      footer: embed.footer ? { text: embed.footer.text, icon_url: embed.footer.iconUrl } : undefined,
      thumbnail: embed.thumbnail ? { url: embed.thumbnail.url } : undefined,
      image: embed.image ? { url: embed.image.url } : undefined,
      author: embed.author
        ? {
            name: embed.author.name,
            url: embed.author.url,
            icon_url: embed.author.iconUrl,
          }
        : undefined,
      fields: embed.fields,
    };
  }

  private transformComponents(components: import('@core').BotComponent[][]): unknown[] {
    const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');

    const styleMap: Record<string, number> = {
      primary: ButtonStyle.Primary,
      secondary: ButtonStyle.Secondary,
      success: ButtonStyle.Success,
      danger: ButtonStyle.Danger,
      link: ButtonStyle.Link,
    };

    return components.map((row) => {
      const actionRow = new ActionRowBuilder();

      for (const component of row) {
        if (component.type === 'button') {
          const button = new ButtonBuilder()
            .setCustomId(component.style === 'link' ? undefined : component.customId)
            .setLabel(component.label)
            .setStyle(styleMap[component.style] ?? ButtonStyle.Secondary)
            .setDisabled(component.disabled ?? false);

          if (component.url && component.style === 'link') {
            button.setURL(component.url);
          }
          if (component.emoji) {
            button.setEmoji(component.emoji);
          }

          actionRow.addComponents(button);
        } else if (component.type === 'select') {
          const select = new StringSelectMenuBuilder()
            .setCustomId(component.customId)
            .setPlaceholder(component.placeholder ?? 'Select an option')
            .addOptions(
              component.options.map((opt) => ({
                label: opt.label,
                value: opt.value,
                description: opt.description,
                emoji: opt.emoji,
                default: opt.default,
              })),
            );

          if (component.minValues !== undefined) select.setMinValues(component.minValues);
          if (component.maxValues !== undefined) select.setMaxValues(component.maxValues);
          if (component.disabled) select.setDisabled(true);

          actionRow.addComponents(select);
        }
      }

      return actionRow;
    });
  }

  // ============================================
  // Slash Command Registration
  // ============================================

  /**
   * Register all slash commands with Discord
   * Call this after all plugins have loaded
   */
  async registerSlashCommands(): Promise<void> {
    const registry = getCommandRegistry();
    const commands = registry.getForPlatform('discord');

    if (commands.length === 0) {
      this.logger.info('No slash commands to register');
      return;
    }

    try {
      const discordCommands = commands.map((cmd) => this.transformCommand(cmd));

      await this.client.application?.commands.set(
        discordCommands as unknown as Parameters<typeof this.client.application.commands.set>[0],
      );

      this.logger.info(`Registered ${commands.length} slash command(s)`, {
        commands: commands.map((c) => c.name),
      });
    } catch (error) {
      this.logger.error('Failed to register slash commands', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private transformCommand(cmd: import('@core').RegisteredCommand): Record<string, unknown> {
    const result: Record<string, unknown> = {
      name: cmd.name,
      description: cmd.description,
    };

    if (cmd.options && cmd.options.length > 0) {
      result.options = cmd.options.map((opt) => this.transformOption(opt));
    }

    if (cmd.subcommands && cmd.subcommands.length > 0) {
      result.options = cmd.subcommands.map((sub) => ({
        type: 1, // SUB_COMMAND
        name: sub.name,
        description: sub.description,
        options: sub.options?.map((opt) => this.transformOption(opt)),
      }));
    }

    if (cmd.subcommandGroups && cmd.subcommandGroups.length > 0) {
      result.options = cmd.subcommandGroups.map((group) => ({
        type: 2, // SUB_COMMAND_GROUP
        name: group.name,
        description: group.description,
        options: group.subcommands.map((sub) => ({
          type: 1,
          name: sub.name,
          description: sub.description,
          options: sub.options?.map((opt) => this.transformOption(opt)),
        })),
      }));
    }

    if (cmd.dmOnly) {
      result.dm_permission = true;
    }

    return result;
  }

  private transformOption(opt: import('@core').SlashOption): Record<string, unknown> {
    const typeMap: Record<string, number> = {
      string: 3,
      integer: 4,
      boolean: 5,
      user: 6,
      channel: 7,
      role: 8,
      number: 10,
      attachment: 11,
    };

    const result: Record<string, unknown> = {
      type: typeMap[opt.type] ?? 3,
      name: opt.name,
      description: opt.description,
      required: opt.required ?? false,
    };

    if (opt.choices) {
      result.choices = opt.choices;
    }

    if (opt.autocomplete) {
      result.autocomplete = true;
    }

    if (opt.minValue !== undefined) {
      result.min_value = opt.minValue;
    }

    if (opt.maxValue !== undefined) {
      result.max_value = opt.maxValue;
    }

    if (opt.minLength !== undefined) {
      result.min_length = opt.minLength;
    }

    if (opt.maxLength !== undefined) {
      result.max_length = opt.maxLength;
    }

    return result;
  }
}
