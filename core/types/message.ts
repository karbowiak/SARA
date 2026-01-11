/**
 * Normalized message types - platform agnostic
 */

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
  replyToId?: string;
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
  replyToId?: string;
  ephemeral?: boolean;
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
