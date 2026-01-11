/**
 * User Repository - Manages user data in the database
 */

import type { Platform } from '../types';
import { getDb } from './client';

export interface StoredUser {
  id: number;
  platform: Platform;
  platform_user_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  is_bot: number;
  first_seen_at: number;
  last_seen_at: number;
  last_message_at: number | null;
  message_count: number;
  created_at: number;
  updated_at: number;
}

export interface UpsertUserParams {
  platform: Platform;
  platformUserId: string;
  username: string;
  displayName?: string;
  avatarUrl?: string;
  isBot?: boolean;
}

/**
 * Get or create a user, updating their last_seen timestamp
 * Returns the user's internal ID for use in other tables
 */
export function upsertUser(params: UpsertUserParams): number {
  const db = getDb();
  const now = Date.now();

  // Try to find existing user
  const existing = db
    .prepare<StoredUser, [string, string]>(`
    SELECT * FROM users 
    WHERE platform = ? AND platform_user_id = ?
  `)
    .get(params.platform, params.platformUserId);

  if (existing) {
    // Update existing user
    db.prepare(`
      UPDATE users SET
        username = ?,
        display_name = ?,
        avatar_url = ?,
        last_seen_at = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      params.username,
      params.displayName ?? existing.display_name,
      params.avatarUrl ?? existing.avatar_url,
      now,
      now,
      existing.id,
    );
    return existing.id;
  }

  // Create new user
  const result = db
    .prepare(`
    INSERT INTO users (
      platform, platform_user_id, username, display_name, avatar_url,
      is_bot, first_seen_at, last_seen_at, message_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `)
    .run(
      params.platform,
      params.platformUserId,
      params.username,
      params.displayName ?? null,
      params.avatarUrl ?? null,
      params.isBot ? 1 : 0,
      now,
      now,
      now,
      now,
    );

  return Number(result.lastInsertRowid);
}

/**
 * Update user's message stats (call after storing a message)
 */
export function incrementMessageCount(userId: number): void {
  const db = getDb();
  const now = Date.now();

  db.prepare(`
    UPDATE users SET
      message_count = message_count + 1,
      last_message_at = ?,
      last_seen_at = ?,
      updated_at = ?
    WHERE id = ?
  `).run(now, now, now, userId);
}

/**
 * Get user by internal ID
 */
export function getUserById(id: number): StoredUser | null {
  const db = getDb();
  return (
    db
      .prepare<StoredUser, [number]>(`
    SELECT * FROM users WHERE id = ?
  `)
      .get(id) ?? null
  );
}

/**
 * Get user by platform identifiers
 */
export function getUserByPlatformId(platform: Platform, platformUserId: string): StoredUser | null {
  const db = getDb();
  return (
    db
      .prepare<StoredUser, [string, string]>(`
    SELECT * FROM users WHERE platform = ? AND platform_user_id = ?
  `)
      .get(platform, platformUserId) ?? null
  );
}

/**
 * Get when a user was last seen
 */
export function getLastSeen(
  platform: Platform,
  platformUserId: string,
): { lastSeen: Date; lastMessage: Date | null } | null {
  const user = getUserByPlatformId(platform, platformUserId);
  if (!user) return null;

  return {
    lastSeen: new Date(user.last_seen_at),
    lastMessage: user.last_message_at ? new Date(user.last_message_at) : null,
  };
}

/**
 * Search users by username (partial match)
 */
export function searchUsers(query: string, limit = 10): StoredUser[] {
  const db = getDb();
  const pattern = `%${query}%`;
  return db
    .prepare<StoredUser, [string, string, number]>(`
    SELECT * FROM users 
    WHERE username LIKE ? OR display_name LIKE ?
    ORDER BY last_seen_at DESC
    LIMIT ?
  `)
    .all(pattern, pattern, limit);
}

/**
 * Get most recently active users
 */
export function getRecentUsers(limit = 20): StoredUser[] {
  const db = getDb();
  return db
    .prepare<StoredUser, [number]>(`
    SELECT * FROM users 
    WHERE is_bot = 0
    ORDER BY last_seen_at DESC
    LIMIT ?
  `)
    .all(limit);
}
