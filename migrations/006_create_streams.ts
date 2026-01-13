/**
 * Migration: Create streams table
 *
 * Stores stream subscriptions for monitoring
 */

import type { Database } from '../core/database/client';

export function up(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS streams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      channel_name TEXT NOT NULL,
      added_by TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      is_live INTEGER DEFAULT 0,
      last_live_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(platform, channel_id, guild_id)
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_streams_platform 
    ON streams(platform)
  `);
}

export function down(db: Database): void {
  db.exec('DROP TABLE IF EXISTS streams');
}
