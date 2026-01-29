/**
 * Messages Repository
 *
 * Database operations for message storage and vector search.
 */

import type { Platform } from '../types';
import { cosineSimilarity, deserializeVector, getDb, serializeVector } from './client';
import { incrementMessageCount, upsertUser } from './users';

export interface StoredMessage {
  id: number;
  user_id: number;
  platform: string;
  platform_message_id: string;
  guild_id: string | null;
  channel_id: string;
  content: string;
  embedding: Buffer | null;
  created_at: number;
  // Joined from users table
  username?: string;
  display_name?: string;
  is_bot?: number;
}

export interface MessageInsert {
  platform: Platform;
  platformMessageId: string;
  guildId?: string | null;
  channelId: string;
  // User info (will be upserted to users table)
  platformUserId: string;
  username: string;
  displayName?: string;
  avatarUrl?: string;
  isBot: boolean;
  // Message content
  content: string;
  timestamp: Date | number;
  embedding?: number[] | Float32Array;
}

export interface SimilarMessage {
  id: number;
  platform: string;
  channelId: string;
  userId: number;
  userName: string;
  content: string;
  isBot: boolean;
  timestamp: number;
  similarity: number;
  score: number; // similarity * time decay
}

export interface SearchOptions {
  /** The embedding vector to search for */
  embedding: number[] | Float32Array;
  /** Filter by channel ID (optional) */
  channelId?: string;
  /** Filter by guild ID (optional) */
  guildId?: string;
  /** Maximum number of results */
  limit?: number;
  /** Time decay factor per day (default: 0.98) */
  decayFactor?: number;
  /** Include bot messages (default: false) */
  includeBot?: boolean;
  /** Only search messages within this time range in milliseconds (default: 30 days = 2592000000ms) */
  timeRangeMs?: number;
}

/**
 * Insert a message into the database
 * Automatically upserts the user and updates their stats
 */
export function insertMessage(message: MessageInsert): number {
  const db = getDb();

  const timestamp = message.timestamp instanceof Date ? message.timestamp.getTime() : message.timestamp;

  // Upsert user and get their internal ID
  const userId = upsertUser({
    platform: message.platform,
    platformUserId: message.platformUserId,
    username: message.username,
    displayName: message.displayName,
    avatarUrl: message.avatarUrl,
    isBot: message.isBot,
  });

  const embedding = message.embedding ? serializeVector(message.embedding) : null;

  const stmt = db.prepare(`
    INSERT INTO messages (
      user_id, platform, platform_message_id, guild_id, channel_id,
      content, embedding, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  try {
    const result = stmt.run(
      userId,
      message.platform,
      message.platformMessageId,
      message.guildId ?? null,
      message.channelId,
      message.content,
      embedding,
      timestamp,
    );

    // Update user's message count
    incrementMessageCount(userId);

    return Number(result.lastInsertRowid);
  } catch (error: unknown) {
    // If message already exists (race condition), return its ID
    if (isUniqueConstraintError(error)) {
      const existing = db
        .prepare('SELECT id FROM messages WHERE platform = ? AND platform_message_id = ?')
        .get(message.platform, message.platformMessageId) as { id: number };

      if (existing) {
        return existing.id;
      }
    }
    throw error;
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: string }).code === 'SQLITE_CONSTRAINT_UNIQUE'
  );
}

/**
 * Update a message's embedding
 */
export function updateMessageEmbedding(id: number, embedding: number[] | Float32Array): void {
  const db = getDb();
  db.prepare('UPDATE messages SET embedding = ? WHERE id = ?').run(serializeVector(embedding), id);
}

/**
 * Search for similar messages using cosine similarity
 *
 * @param options - Search options including embedding, filters, and time range
 * @param options.timeRangeMs - Only search messages within this time range (default: 30 days)
 * @returns Array of similar messages sorted by score (similarity * time decay)
 */
export function searchSimilar(options: SearchOptions): SimilarMessage[] {
  const db = getDb();
  const {
    embedding,
    channelId,
    guildId,
    limit = 10,
    decayFactor = 0.98,
    includeBot = false,
    timeRangeMs = 2592000000, // 30 days default
  } = options;

  // Build query with optional filters - join with users for name/bot info
  let query = `
    SELECT m.*, u.username, u.display_name, u.is_bot 
    FROM messages m
    JOIN users u ON m.user_id = u.id
    WHERE m.embedding IS NOT NULL
  `;
  const params: (string | number)[] = [];

  if (!includeBot) {
    query += ' AND u.is_bot = 0';
  }

  if (channelId) {
    query += ' AND m.channel_id = ?';
    params.push(channelId);
  }

  if (guildId) {
    query += ' AND m.guild_id = ?';
    params.push(guildId);
  }

  // Add time range filter
  if (timeRangeMs > 0) {
    const cutoffTime = Date.now() - timeRangeMs;
    query += ' AND m.created_at > ?';
    params.push(cutoffTime);
  }

  const rows = db.prepare(query).all(...params) as StoredMessage[];

  const now = Date.now();
  const queryVector = embedding instanceof Float32Array ? embedding : new Float32Array(embedding);

  // Calculate similarity and time-decayed score for each message
  const results: SimilarMessage[] = [];

  for (const row of rows) {
    if (!row.embedding) continue;

    const messageVector = deserializeVector(row.embedding);
    const similarity = cosineSimilarity(queryVector, messageVector);

    // Calculate age in days
    const ageMs = now - row.created_at;
    const ageDays = ageMs / (24 * 60 * 60 * 1000);

    // Apply time decay: score = similarity * decay^days
    const score = similarity * decayFactor ** ageDays;

    results.push({
      id: row.id,
      platform: row.platform,
      channelId: row.channel_id,
      userId: row.user_id,
      userName: row.display_name ?? row.username ?? 'Unknown',
      content: row.content,
      isBot: Boolean(row.is_bot),
      timestamp: row.created_at,
      similarity,
      score,
    });
  }

  // Sort by score (descending) and limit
  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * Get recent messages from a channel
 */
export function getRecentMessages(
  channelId: string,
  limit = 20,
): (StoredMessage & { username: string; is_bot: number })[] {
  const db = getDb();
  return db
    .prepare(`
    SELECT m.*, u.username, u.display_name, u.is_bot 
    FROM messages m
    JOIN users u ON m.user_id = u.id
    WHERE m.channel_id = ? 
    ORDER BY m.created_at DESC 
    LIMIT ?
  `)
    .all(channelId, limit) as (StoredMessage & { username: string; is_bot: number })[];
}

/**
 * Get message count
 */
export function getMessageCount(): number {
  const db = getDb();
  const result = db.prepare('SELECT COUNT(*) as count FROM messages').get() as { count: number };
  return result.count;
}

/**
 * Check if a message already exists (by platform message ID)
 */
export function messageExists(platform: string, platformMessageId: string): boolean {
  const db = getDb();
  return (
    db
      .prepare('SELECT 1 FROM messages WHERE platform = ? AND platform_message_id = ? LIMIT 1')
      .get(platform, platformMessageId) != null
  );
}

/**
 * Get a specific message by platform and platform message ID
 *
 * @param platform - The platform (e.g., 'discord')
 * @param platformMessageId - The platform-specific message ID
 * @returns The stored message with user info, or null if not found
 */
export function getMessageByPlatformId(platform: string, platformMessageId: string): StoredMessage | null {
  const db = getDb();
  return db
    .prepare<StoredMessage, [string, string]>(`
    SELECT m.*, u.username, u.display_name, u.is_bot 
    FROM messages m
    JOIN users u ON m.user_id = u.id
    WHERE m.platform = ? AND m.platform_message_id = ?
  `)
    .get(platform, platformMessageId) as StoredMessage | null;
}

// ============================================================================
// Profile Message Retrieval
// ============================================================================

export interface ProfileMessage {
  id: number;
  channelId: string;
  createdAt: number;
  content: string;
  // Reply context (null if not a reply - requires reply_to_message_id column)
  replyToContent: string | null;
  replyToAuthor: string | null;
}

export interface GetMessagesForProfileParams {
  userId: number;
  guildId: string;
  afterTimestamp: number; // Unix timestamp - only get messages after this
  limit: number; // Max messages to return
}

/**
 * Get messages for profile generation
 *
 * Retrieves a user's messages in a guild for AI profile analysis.
 * Currently returns messages without reply context since the messages
 * table doesn't have a reply_to_message_id column.
 *
 * @param params - Parameters including userId, guildId, afterTimestamp, and limit
 * @returns Array of ProfileMessage objects ordered by timestamp DESC
 */
export function getMessagesForProfile(params: GetMessagesForProfileParams): ProfileMessage[] {
  const db = getDb();
  const { userId, guildId, afterTimestamp, limit } = params;

  // Note: Reply context (replyToContent, replyToAuthor) requires a reply_to_message_id
  // column in the messages table. When that column is added, update this query to:
  // LEFT JOIN messages parent ON m.reply_to_message_id = parent.platform_message_id
  //   AND parent.guild_id = m.guild_id
  // LEFT JOIN users parent_user ON parent.user_id = parent_user.id
  const rows = db
    .prepare(
      `
    SELECT 
      m.id,
      m.channel_id as channelId,
      m.created_at as createdAt,
      m.content
    FROM messages m
    WHERE m.user_id = ? 
      AND m.guild_id = ?
      AND m.created_at > ?
    ORDER BY m.created_at DESC
    LIMIT ?
  `,
    )
    .all(userId, guildId, afterTimestamp, limit) as Array<{
    id: number;
    channelId: string;
    createdAt: number;
    content: string;
  }>;

  // Map to ProfileMessage with null reply context
  return rows.map((row) => ({
    id: row.id,
    channelId: row.channelId,
    createdAt: row.createdAt,
    content: row.content,
    replyToContent: null,
    replyToAuthor: null,
  }));
}

/**
 * Format profile messages for LLM prompt consumption
 *
 * Formats messages in a human-readable format:
 * #channel / 2026-01-28 14:32 / Username: Message content
 *   ↳ replying to OtherUser: "Parent message content"
 *
 * @param messages - Array of ProfileMessage objects
 * @param userName - The user's display name
 * @returns Formatted string for LLM prompt
 */
export function formatMessagesForProfile(messages: ProfileMessage[], userName: string): string {
  const MAX_CONTENT_LENGTH = 500;
  const MAX_REPLY_LENGTH = 200;

  const truncate = (text: string, maxLength: number): string => {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength - 3) + '...';
  };

  const formatDate = (timestamp: number): string => {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}`;
  };

  const lines: string[] = [];

  for (const msg of messages) {
    const dateStr = formatDate(msg.createdAt);
    const content = truncate(msg.content, MAX_CONTENT_LENGTH);
    const channelDisplay = msg.channelId; // Use channel ID since we don't have channel names

    // Main message line
    lines.push(`#${channelDisplay} / ${dateStr} / ${userName}: ${content}`);

    // Reply context if available
    if (msg.replyToAuthor && msg.replyToContent) {
      const replyContent = truncate(msg.replyToContent, MAX_REPLY_LENGTH);
      lines.push(`  ↳ replying to ${msg.replyToAuthor}: "${replyContent}"`);
    }

    lines.push(''); // Empty line between messages
  }

  // Remove trailing empty line
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  return lines.join('\n');
}
