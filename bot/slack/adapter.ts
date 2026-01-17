/**
 * Slack Adapter - Translates Slack events to platform-agnostic events
 */

import type { BotChannel, BotMessage, BotUser, EventBus, Logger } from '@core';
import { App } from '@slack/bolt';

export interface SlackAdapterOptions {
  botToken: string;
  appToken: string;
  eventBus: EventBus;
  logger: Logger;
}

/**
 * Slack platform adapter
 *
 * Converts Slack Bolt events to normalized events and vice versa.
 */
export class SlackAdapter {
  private app: App;
  private eventBus: EventBus;
  private logger: Logger;
  private botUserId?: string;
  private userDirectoryByTeam: Map<string, Map<string, Set<string>>> = new Map();
  private userAliasesByTeam: Map<string, Map<string, Set<string>>> = new Map();
  private userTeams: Map<string, Set<string>> = new Map();
  private userRefreshTimer?: NodeJS.Timeout;

  constructor(options: SlackAdapterOptions) {
    this.eventBus = options.eventBus;
    this.logger = options.logger;

    // Initialize Slack Bolt app with Socket Mode
    this.app = new App({
      token: options.botToken,
      appToken: options.appToken,
      socketMode: true,
      logLevel: 'error' as any, // Reduce Slack SDK noise
    });

    this.setupIncomingEvents();
    this.setupOutgoingEvents();
  }

  /**
   * Connect to Slack
   */
  async connect(): Promise<void> {
    this.logger.info('Slack adapter connecting...');

    await this.app.start();

    // Get bot user ID and verify authentication
    const authResult = await this.app.client.auth.test();
    this.botUserId = authResult.user_id;

    this.logger.info(`Slack connected as ${authResult.user} (${this.botUserId})`);

    // Verify required permissions
    await this.verifyPermissions();

    await this.refreshUserDirectory();
    this.startUserRefreshTimer();

    this.eventBus.fire('bot:ready', { platform: 'slack' });
  }

  /**
   * Verify bot has all required OAuth scopes
   */
  private async verifyPermissions(): Promise<void> {
    try {
      const authInfo = await this.app.client.auth.test();

      // Required scopes for basic functionality
      const requiredScopes = {
        core: [
          'chat:write', // Send messages
          'files:write', // Upload files/images
          'users:read', // Read user information
          'channels:read', // View basic channel info
          'groups:read', // View private channel info
          'im:read', // View DM info
          'mpim:read', // View group DM info
        ],
        messageReading: [
          'channels:history', // Read messages in public channels
          'groups:history', // Read messages in private channels
          'im:history', // Read direct messages
          'mpim:history', // Read group direct messages
        ],
        mentions: [
          'app_mentions:read', // Receive @mentions
        ],
        optional: [
          'chat:write.public', // Send to channels bot isn't in (optional)
          'files:read', // Read file attachments (optional)
          'reactions:read', // See reactions (optional)
          'reactions:write', // Add reactions (optional)
        ],
      };

      // Get current bot scopes from auth.test response
      // Note: auth.test doesn't return scopes, so we'll try API calls instead
      const missingScopes: string[] = [];

      // Test each permission by making a safe API call
      const tests = [
        {
          scope: 'users:read',
          test: async () => {
            if (authInfo.user_id) {
              await this.app.client.users.info({ user: authInfo.user_id });
            }
          },
        },
        {
          scope: 'channels:read',
          test: async () => {
            await this.app.client.conversations.list({ types: 'public_channel', limit: 1 });
          },
        },
        {
          scope: 'groups:read',
          test: async () => {
            await this.app.client.conversations.list({ types: 'private_channel', limit: 1 });
          },
        },
        {
          scope: 'im:read',
          test: async () => {
            await this.app.client.conversations.list({ types: 'im', limit: 1 });
          },
        },
        {
          scope: 'mpim:read',
          test: async () => {
            await this.app.client.conversations.list({ types: 'mpim', limit: 1 });
          },
        },
        {
          scope: 'channels:history',
          test: async () => {
            // Try to list public channels with history
            const channels = await this.app.client.conversations.list({ types: 'public_channel', limit: 1 });
            if (channels.channels && channels.channels.length > 0) {
              const channel = channels.channels[0];
              if (channel?.id) {
                await this.app.client.conversations.history({ channel: channel.id, limit: 1 });
              }
            }
          },
        },
        {
          scope: 'chat:write',
          critical: true,
          reason: 'Cannot send messages without this',
        },
        {
          scope: 'app_mentions:read',
          critical: true,
          reason: 'Cannot receive @mentions without this - bot will be deaf!',
        },
      ];

      for (const test of tests) {
        if ('test' in test && test.test) {
          try {
            await test.test();
          } catch (error: any) {
            if (error?.data?.error === 'missing_scope') {
              missingScopes.push(test.scope);
            }
          }
        }
      }

      // Add note about critical scopes we can't test
      const criticalScopes = tests
        .filter((t) => 'critical' in t && t.critical)
        .map((t) => ({
          scope: t.scope,
          reason: ('reason' in t ? t.reason : 'Required for core functionality') as string,
        }));

      // Report findings
      if (missingScopes.length > 0) {
        this.logger.error('❌ MISSING REQUIRED SLACK PERMISSIONS');
        this.logger.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        this.logger.error('');
        this.logger.error('ADD THESE SCOPES (copy-paste this entire list):');
        this.logger.error('');

        // Combine all required scopes into one simple list
        const allRequiredScopes = [
          ...requiredScopes.core,
          ...requiredScopes.messageReading,
          ...requiredScopes.mentions,
        ];

        for (const scope of allRequiredScopes) {
          const isMissing = missingScopes.includes(scope);
          const prefix = isMissing ? '❌' : '⚠️ ';
          this.logger.error(`  ${prefix} ${scope}`);
        }

        this.logger.error('');
        this.logger.error('Optional (recommended):');
        for (const scope of requiredScopes.optional) {
          this.logger.error(`  ○ ${scope}`);
        }

        this.logger.error('');
        this.logger.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        this.logger.error('HOW TO FIX:');
        this.logger.error('');
        this.logger.error('1. Go to: https://api.slack.com/apps → Select "aifuntimebot"');
        this.logger.error('2. Go to "OAuth & Permissions" → "Bot Token Scopes"');
        this.logger.error('3. Add ALL scopes with ❌ or ⚠️  above');
        this.logger.error('4. Click "Reinstall to Workspace" at the top');
        this.logger.error('5. Copy the NEW "Bot User OAuth Token"');
        this.logger.error('6. Update SLACK_BOT_TOKEN in config with the new token');
        this.logger.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        this.logger.error('');

        throw new Error(`Missing ${missingScopes.length} required Slack permissions. See instructions above.`);
      }

      // Success - but warn about critical scopes we couldn't test
      this.logger.info('✓ All testable Slack permissions verified');

      if (criticalScopes.length > 0) {
        this.logger.warn('');
        this.logger.warn('⚠️  CRITICAL SCOPES (cannot be tested automatically):');
        for (const { scope, reason } of criticalScopes) {
          this.logger.warn(`   • ${scope} - ${reason}`);
        }
        this.logger.warn("   If bot doesn't work, verify these scopes are added!");
      }
    } catch (error: any) {
      if (error.message?.includes('Missing required Slack permissions')) {
        throw error; // Re-throw our detailed error
      }

      // Other auth errors
      this.logger.error('Failed to verify Slack permissions', {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Disconnect from Slack
   */
  async disconnect(): Promise<void> {
    this.logger.info('Slack adapter disconnecting...');
    if (this.userRefreshTimer) {
      clearInterval(this.userRefreshTimer);
      this.userRefreshTimer = undefined;
    }
    await this.app.stop();
  }

  /**
   * Get the Slack app instance (for advanced use)
   */
  getApp(): App {
    return this.app;
  }

  // ============================================
  // Incoming Events (Slack → EventBus)
  // ============================================

  private setupIncomingEvents(): void {
    // Listen to all message events
    this.app.event('message', async ({ event, client }) => {
      this.logger.debug('Received Slack message event', {
        type: event.type,
        subtype: (event as any).subtype,
        user: (event as any).user,
        channel: (event as any).channel,
      });

      // Ignore bot messages (including our own)
      if (event.subtype === 'bot_message' || event.subtype === 'message_changed') {
        this.logger.debug('Ignoring bot/changed message');
        return;
      }

      // Type guard for user messages
      if (!('user' in event) || !event.user) {
        this.logger.debug('Ignoring message without user');
        return;
      }

      try {
        this.logger.debug('Transforming message from user', { user: event.user });
        const message = await this.transformMessage(event, client);
        this.logger.debug('Firing message:received event');
        this.eventBus.fire('message:received', message);
      } catch (error) {
        this.logger.error('Failed to transform Slack message', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    // User added to workspace
    this.app.event('team_join', async ({ event }) => {
      const user = (event as any).user;
      if (!user?.id) return;
      const teamId = user.team_id || (event as any).team;
      if (!teamId) return;
      this.upsertUserAliases(teamId, user.id, user);
    });

    // User updated
    this.app.event('user_change', async ({ event }) => {
      const user = (event as any).user;
      if (!user?.id) return;
      const teamId = user.team_id || (event as any).team;
      if (!teamId) return;
      this.upsertUserAliases(teamId, user.id, user);
    });

    // NOTE: We intentionally do NOT handle 'app_mention' event separately.
    // The 'message' event already fires for @mentions AND sets mentionedBot=true.
    // Handling both would cause duplicate message processing.

    // Error handling
    this.app.error(async (error) => {
      this.logger.error('Slack client error', {
        error: error instanceof Error ? error.message : String(error),
      });
      this.eventBus.fire('bot:error', {
        error: error instanceof Error ? error : new Error(String(error)),
        context: 'slack',
      });
    });
  }

  // ============================================
  // Outgoing Events (EventBus → Slack)
  // ============================================

  private setupOutgoingEvents(): void {
    // Send message
    this.eventBus.on('message:send', async (request) => {
      if (request.platform !== 'slack') return;

      try {
        // Convert markdown to Slack's mrkdwn format
        const content = this.markdownToMrkdwn(request.message.content || '');

        // Handle file attachments
        if (request.message.attachments && request.message.attachments.length > 0) {
          for (const attachment of request.message.attachments) {
            await this.app.client.files.uploadV2({
              channel_id: request.channelId,
              file: attachment.data,
              filename: attachment.filename,
              initial_comment: content || undefined,
              ...(request.message.threadId ? { thread_ts: request.message.threadId } : {}),
            });
          }

          this.logger.debug('Sent Slack file(s)', {
            channel: request.channelId,
            fileCount: request.message.attachments.length,
          });
          return; // Don't send text message separately if we uploaded files
        }

        // Only reply in thread if threadId is explicitly set
        // (replyToId is for Discord's reply reference feature, not Slack threads)
        await this.app.client.chat.postMessage({
          channel: request.channelId,
          text: content,
          ...(request.message.threadId ? { thread_ts: request.message.threadId } : {}),
        } as any);

        this.logger.debug('Sent Slack message', {
          channel: request.channelId,
          length: content?.length ?? 0,
        });
      } catch (error) {
        this.logger.error('Failed to send Slack message', {
          channelId: request.channelId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    // Start typing indicator
    this.eventBus.on('typing:start', async (request) => {
      if (request.platform !== 'slack') return;
      // Slack doesn't support typing indicators for modern apps (RTM API deprecated)
      // This is intentionally a no-op
    });

    // Stop typing indicator
    this.eventBus.on('typing:stop', async (request) => {
      if (request.platform !== 'slack') return;
      // No-op on Slack
    });

    // Resolve @name to user ID using cached directory
    this.eventBus.on('user:resolve', async (request) => {
      if (request.platform !== 'slack') return;
      const resolved = this.resolveUserId(request.name, request.guildId);
      request.callback(resolved);
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

  private getTeamDirectory(teamId: string): Map<string, Set<string>> {
    let directory = this.userDirectoryByTeam.get(teamId);
    if (!directory) {
      directory = new Map();
      this.userDirectoryByTeam.set(teamId, directory);
    }
    return directory;
  }

  private getTeamAliases(teamId: string): Map<string, Set<string>> {
    let aliases = this.userAliasesByTeam.get(teamId);
    if (!aliases) {
      aliases = new Map();
      this.userAliasesByTeam.set(teamId, aliases);
    }
    return aliases;
  }

  private upsertUserAliases(teamId: string, userId: string, user: any): void {
    const directory = this.getTeamDirectory(teamId);
    const aliasesByUser = this.getTeamAliases(teamId);

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
    const profile = user.profile ?? {};
    const candidateNames = [
      user.name,
      user.real_name,
      profile.display_name,
      profile.real_name,
      profile.display_name_normalized,
      profile.real_name_normalized,
    ]
      .map((n) => this.normalizeName(n))
      .filter((n): n is string => Boolean(n));

    for (const alias of candidateNames) {
      aliases.add(alias);
      const set = directory.get(alias) ?? new Set<string>();
      set.add(userId);
      directory.set(alias, set);
    }

    aliasesByUser.set(userId, aliases);

    const userTeamSet = this.userTeams.get(userId) ?? new Set<string>();
    userTeamSet.add(teamId);
    this.userTeams.set(userId, userTeamSet);
  }

  private resolveUserId(name: string, teamId?: string): string | null {
    if (!teamId) return null;
    const normalized = this.normalizeName(name);
    if (!normalized) return null;
    const directory = this.getTeamDirectory(teamId);
    const matches = directory.get(normalized);
    if (!matches || matches.size !== 1) return null;
    return matches.values().next().value ?? null;
  }

  private async refreshUserDirectory(): Promise<void> {
    try {
      const auth = await this.app.client.auth.test();
      const teamId = auth.team_id;
      if (!teamId) return;

      this.userDirectoryByTeam.set(teamId, new Map());
      this.userAliasesByTeam.set(teamId, new Map());

      let cursor: string | undefined;
      do {
        const response = await this.app.client.users.list({
          limit: 200,
          cursor,
        });
        const members = (response as any).members ?? [];
        for (const user of members) {
          if (!user?.id) continue;
          this.upsertUserAliases(teamId, user.id, user);
        }
        cursor = (response as any).response_metadata?.next_cursor || undefined;
      } while (cursor);

      this.logger.info('Slack user directory refreshed', { teamId });
    } catch (error) {
      this.logger.error('Failed to refresh Slack user directory', {
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
  }

  // ============================================
  // Message Transformation
  // ============================================

  private async transformMessage(event: any, client: any): Promise<BotMessage> {
    // Get user info
    const userInfo = await client.users.info({ user: event.user });
    const slackUser = userInfo.user as any;

    // Get channel info
    let channelInfo: any;
    try {
      if (event.channel) {
        channelInfo = await client.conversations.info({ channel: event.channel });
      } else {
        channelInfo = { channel: { id: 'unknown', name: undefined } };
      }
    } catch {
      // DM or channel we can't access
      channelInfo = { channel: { id: event.channel || 'unknown', name: undefined } };
    }

    // Extract mentioned user IDs from text (Slack format: <@U123ABC>)
    const mentionRegex = /<@([A-Z0-9]+)>/g;
    const mentionedUserIds: string[] = [];
    const textContent = event.text || '';
    let match = mentionRegex.exec(textContent);
    while (match !== null) {
      if (match[1]) {
        mentionedUserIds.push(match[1]);
      }
      match = mentionRegex.exec(textContent);
    }

    // Check if bot was mentioned OR if this is a DM (always respond in DMs)
    const isDM = channelInfo.channel?.is_im === true;
    const mentionedBot = isDM || (this.botUserId ? mentionedUserIds.includes(this.botUserId) : false);

    // Fetch mentioned user info
    const mentionedUsers: BotUser[] = [];
    for (const userId of mentionedUserIds) {
      try {
        const userInfo = await client.users.info({ user: userId });
        mentionedUsers.push(this.transformUser(userInfo.user as any));
      } catch {
        // Skip if we can't fetch user info
      }
    }

    // Get team (workspace) ID
    const teamId = event.team || channelInfo.channel?.context_team_id;

    // Thread detection:
    // - event.thread_ts exists = message is in a thread
    // - event.thread_ts === event.ts = this is the thread parent (first message)
    // - event.thread_ts !== event.ts = this is a reply in the thread
    // We set threadId if in a thread, so replies stay in the same thread
    const isInThread = !!event.thread_ts;
    const threadId = isInThread ? event.thread_ts : undefined;

    return {
      id: event.ts, // Slack uses timestamps as message IDs
      content: event.text || '',
      author: this.transformUser(slackUser),
      channel: this.transformChannel(channelInfo.channel),
      attachments: [], // TODO: Handle Slack file attachments
      guildId: teamId,
      guildName: undefined, // We'd need to fetch team info for this
      mentionedUserIds,
      mentionedUsers,
      mentionedBot,
      replyToId: undefined, // Slack doesn't have reply references like Discord
      threadId, // Set if message is in a thread (so bot replies stay in thread)
      timestamp: new Date(Number.parseFloat(event.ts) * 1000),
      platform: 'slack',
      raw: event,
    };
  }

  private transformUser(slackUser: any): BotUser {
    return {
      id: slackUser.id,
      name: slackUser.name || slackUser.real_name || 'Unknown',
      displayName: slackUser.real_name || slackUser.name || 'Unknown',
      isBot: slackUser.is_bot || false,
      avatarUrl: slackUser.profile?.image_192 || slackUser.profile?.image_72,
    };
  }

  private transformChannel(slackChannel: any): BotChannel {
    // Determine channel type
    let type: 'dm' | 'group' | 'guild' | 'thread' = 'guild';
    if (slackChannel.is_im) {
      type = 'dm';
    } else if (slackChannel.is_private || slackChannel.is_mpim) {
      type = 'group';
    }

    return {
      id: slackChannel.id,
      name: slackChannel.name,
      type,
    };
  }

  /**
   * Convert standard Markdown to Slack's mrkdwn format
   *
   * Slack supports: *bold*, _italic_, ~strike~, `code`, ```blocks```, <url|text>, > quotes
   * Slack does NOT support: tables, nested lists, underline, headings
   */
  private markdownToMrkdwn(text: string): string {
    if (!text) return text;

    // Use Unicode private use area characters as placeholders (won't appear in normal text)
    const CODE_BLOCK_MARKER = '\uE000';
    const INLINE_CODE_MARKER = '\uE001';
    const SLACK_BOLD_MARKER = '\uE002';
    const SLACK_ITALIC_MARKER = '\uE003';

    // Protect code blocks from conversion
    const codeBlocks: string[] = [];
    let result = text.replace(/```[\s\S]*?```/g, (match) => {
      codeBlocks.push(match);
      return `${CODE_BLOCK_MARKER}${codeBlocks.length - 1}${CODE_BLOCK_MARKER}`;
    });

    // Protect inline code from conversion
    const inlineCode: string[] = [];
    result = result.replace(/`[^`]+`/g, (match) => {
      inlineCode.push(match);
      return `${INLINE_CODE_MARKER}${inlineCode.length - 1}${INLINE_CODE_MARKER}`;
    });

    // Convert markdown links [text](url) → <url|text>
    result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<$2|$1>');

    // Convert headings ### Text → *Text* (bold, on its own line)
    result = result.replace(/^#{1,6}\s+(.+)$/gm, `${SLACK_BOLD_MARKER}$1${SLACK_BOLD_MARKER}`);

    // Convert bold **text** → temporary marker (to avoid conflicts with italic)
    result = result.replace(/\*\*(.+?)\*\*/g, `${SLACK_BOLD_MARKER}$1${SLACK_BOLD_MARKER}`);
    result = result.replace(/__(.+?)__/g, `${SLACK_BOLD_MARKER}$1${SLACK_BOLD_MARKER}`);

    // Convert markdown italic *text* → temporary marker
    // Match *text* but not **text** (already converted above)
    result = result.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, `${SLACK_ITALIC_MARKER}$1${SLACK_ITALIC_MARKER}`);

    // Convert markdown italic _text_ → temporary marker (but not __text__ which is bold)
    result = result.replace(/(?<!_)_([^_]+)_(?!_)/g, `${SLACK_ITALIC_MARKER}$1${SLACK_ITALIC_MARKER}`);

    // Convert strikethrough ~~text~~ → ~text~
    result = result.replace(/~~(.+?)~~/g, '~$1~');

    // Convert markdown tables to simple text (Slack doesn't support tables)
    // Remove table header separator rows like |---|---|
    result = result.replace(/^\|[-:| ]+\|$/gm, '');
    // Convert table rows | cell | cell | to plain text
    result = result.replace(/^\|(.+)\|$/gm, (_, content) => {
      return content
        .split('|')
        .map((cell: string) => cell.trim())
        .filter(Boolean)
        .join(' | ');
    });

    // Replace markers with Slack formatting
    result = result.replaceAll(SLACK_BOLD_MARKER, '*');
    result = result.replaceAll(SLACK_ITALIC_MARKER, '_');

    // Restore inline code
    for (let i = 0; i < inlineCode.length; i++) {
      result = result.replace(`${INLINE_CODE_MARKER}${i}${INLINE_CODE_MARKER}`, inlineCode[i]);
    }

    // Restore code blocks
    for (let i = 0; i < codeBlocks.length; i++) {
      result = result.replace(`${CODE_BLOCK_MARKER}${i}${CODE_BLOCK_MARKER}`, codeBlocks[i]);
    }

    return result;
  }
}
