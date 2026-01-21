/**
 * Normalized message types - platform agnostic
 */

import type { BotEmbed } from './command';

/**
 * Platform identifier
 */
export type Platform = 'discord' | 'slack' | 'telegram' | 'test';

/**
 * Channel types normalized across platforms
 */
export type ChannelType = 'dm' | 'group' | 'guild' | 'thread';

/**
 * User information
 */
export interface BotUser {
  id: string;
  name: string;
  displayName?: string;
  isBot: boolean;
  avatarUrl?: string;
  /** Platform-specific role IDs (Discord roles, Slack groups, etc.) */
  roleIds?: string[];
}

/**
 * Channel information
 */
export interface BotChannel {
  id: string;
  name?: string;
  type: ChannelType;
  guildId?: string;
  guildName?: string;
  /** Whether the channel is age-restricted (NSFW) */
  nsfw?: boolean;
  /** Channel topic/description set by admins */
  topic?: string;
}

/**
 * File attachment
 */
export interface BotAttachment {
  id: string;
  filename: string;
  url: string;
  contentType?: string;
  size?: number;
}

/**
 * Platform-agnostic message
 */
export interface BotMessage {
  id: string;
  content: string;
  author: BotUser;
  channel: BotChannel;
  attachments: BotAttachment[];
  /** Message this is a direct reply to (Discord: reply reference, Slack: unused) */
  replyToId?: string;
  /** Thread this message belongs to (Slack: thread_ts, Discord: unused - threads have own channel ID) */
  threadId?: string;
  /** Guild/server ID (null for DMs) */
  guildId?: string;
  /** Guild/server name (null for DMs) */
  guildName?: string;
  /** IDs of mentioned users */
  mentionedUserIds: string[];
  /** Full info about mentioned users (for name→ID mapping) */
  mentionedUsers: BotUser[];
  /** Whether the bot was directly mentioned/highlighted */
  mentionedBot: boolean;
  timestamp: Date;
  platform: Platform;
  /** Original platform-specific message object */
  raw?: unknown;
}

/**
 * Outgoing message content
 */
export interface OutgoingMessage {
  content?: string;
  attachments?: OutgoingAttachment[];
  /** Message ID to reply to (Discord: creates reply reference, Slack: ignored) */
  replyToId?: string;
  /** Thread ID for threaded replies (Slack: thread_ts, Discord: ignored - use channel threads) */
  threadId?: string;
  ephemeral?: boolean;
  /** Rich embeds */
  embeds?: BotEmbed[];
  /** Interactive components (buttons, selects) - rows of components */
  components?: import('./command').BotComponent[][];
}

/**
 * Outgoing attachment (file to upload)
 */
export interface OutgoingAttachment {
  filename: string;
  data: Buffer | string;
  contentType?: string;
}

/**
 * Message send request (includes target)
 */
export interface MessageSendRequest {
  channelId: string;
  message: OutgoingMessage;
  platform: Platform;
}

/**
 * DM send request (send to a user directly)
 */
export interface DMSendRequest {
  userId: string;
  message: OutgoingMessage;
  platform: Platform;
}

/**
 * Reaction info
 */
export interface BotReaction {
  messageId: string;
  channelId: string;
  emoji: string;
  userId: string;
  platform: Platform;
}
