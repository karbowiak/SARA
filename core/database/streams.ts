/**
 * Streams Repository - Manages stream subscriptions
 */

import { getDb } from './client';

export interface StoredStream {
  id: number;
  platform: string;
  channel_id: string;
  channel_name: string;
  added_by: string;
  guild_id: string;
  is_live: number;
  last_live_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface CreateStreamParams {
  platform: string;
  channelId: string;
  channelName: string;
  addedBy: string;
  guildId: string;
}

/**
 * Add a stream subscription
 */
export function addSubscription(params: CreateStreamParams): number {
  const db = getDb();
  const now = Date.now();

  const result = db
    .prepare(`
    INSERT INTO streams (
      platform, channel_id, channel_name, added_by, guild_id,
      is_live, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 0, ?, ?)
  `)
    .run(params.platform, params.channelId, params.channelName, params.addedBy, params.guildId, now, now);

  return Number(result.lastInsertRowid);
}

/**
 * Remove a stream subscription
 */
export function removeSubscription(platform: string, channelId: string, guildId: string): boolean {
  const db = getDb();
  const result = db
    .prepare(`
    DELETE FROM streams 
    WHERE platform = ? AND channel_id = ? AND guild_id = ?
  `)
    .run(platform, channelId, guildId);

  return result.changes > 0;
}

/**
 * Get all subscriptions, optionally filtered by platform
 */
export function getSubscriptions(platform?: string): StoredStream[] {
  const db = getDb();

  if (platform) {
    return db
      .prepare<StoredStream, [string]>(`
      SELECT * FROM streams WHERE platform = ?
    `)
      .all(platform);
  }

  return db
    .prepare<StoredStream, []>(`
    SELECT * FROM streams
  `)
    .all();
}

/**
 * Update stream live status
 */
export function updateStreamStatus(id: number, isLive: boolean, lastLiveAt?: number): void {
  const db = getDb();
  const now = Date.now();

  if (lastLiveAt) {
    db.prepare(`
      UPDATE streams 
      SET is_live = ?, last_live_at = ?, updated_at = ?
      WHERE id = ?
    `).run(isLive ? 1 : 0, lastLiveAt, now, id);
  } else {
    db.prepare(`
      UPDATE streams 
      SET is_live = ?, updated_at = ?
      WHERE id = ?
    `).run(isLive ? 1 : 0, now, id);
  }
}

/**
 * Get subscription by ID
 */
export function getSubscriptionById(id: number): StoredStream | null {
  const db = getDb();
  return (
    db
      .prepare<StoredStream, [number]>(`
    SELECT * FROM streams WHERE id = ?
  `)
      .get(id) ?? null
  );
}

/**
 * Check if subscription exists
 */
export function hasSubscription(platform: string, channelId: string, guildId: string): boolean {
  const db = getDb();
  const result = db
    .prepare<{ count: number }, [string, string, string]>(`
    SELECT COUNT(*) as count FROM streams 
    WHERE platform = ? AND channel_id = ? AND guild_id = ?
  `)
    .get(platform, channelId, guildId);

  return (result?.count ?? 0) > 0;
}
