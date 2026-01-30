/**
 * Migration: Add is_global column to memories and user_profiles tables
 * This allows users to store memories and profiles globally (shared across all guilds)
 * instead of per-guild.
 */

import type { Database } from 'bun:sqlite';

export function up(db: Database): void {
  // Add is_global column to memories table
  // Default 0 (false) = per-guild behavior (existing default)
  // 1 (true) = global memory, accessible from all guilds and DMs
  db.exec(`
    ALTER TABLE memories ADD COLUMN is_global INTEGER NOT NULL DEFAULT 0;
  `);

  // Add is_global column to user_profiles table
  db.exec(`
    ALTER TABLE user_profiles ADD COLUMN is_global INTEGER NOT NULL DEFAULT 0;
  `);

  // Add index for efficient global memory lookups
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_memories_user_global 
    ON memories(user_id, is_global);
  `);

  // Add index for efficient global profile lookups
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_profiles_user_global 
    ON user_profiles(user_id, is_global);
  `);
}

export function down(db: Database): void {
  // Drop indexes first
  db.exec(`DROP INDEX IF EXISTS idx_memories_user_global`);
  db.exec(`DROP INDEX IF EXISTS idx_profiles_user_global`);

  // SQLite doesn't support DROP COLUMN directly, so we need to recreate tables
  // For memories table
  db.exec(`
    CREATE TABLE memories_backup AS SELECT 
      id, user_id, guild_id, type, content, embedding, source, created_at, updated_at
    FROM memories;
  `);
  db.exec(`DROP TABLE memories`);
  db.exec(`
    CREATE TABLE memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      guild_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('preference', 'fact', 'instruction', 'context', 'profile_update')),
      content TEXT NOT NULL,
      embedding BLOB,
      source TEXT NOT NULL DEFAULT 'explicit' CHECK(source IN ('explicit', 'inferred')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
  db.exec(`INSERT INTO memories SELECT * FROM memories_backup`);
  db.exec(`DROP TABLE memories_backup`);

  // For user_profiles table
  db.exec(`
    CREATE TABLE user_profiles_backup AS SELECT 
      id, user_id, guild_id, summary, personality, interests, facts,
      opted_out, messages_analyzed, last_generated_at, created_at, updated_at
    FROM user_profiles;
  `);
  db.exec(`DROP TABLE user_profiles`);
  db.exec(`
    CREATE TABLE user_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      guild_id TEXT NOT NULL,
      summary TEXT,
      personality TEXT,
      interests TEXT,
      facts TEXT,
      opted_out INTEGER NOT NULL DEFAULT 0,
      messages_analyzed INTEGER NOT NULL DEFAULT 0,
      last_generated_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(user_id, guild_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
  db.exec(`INSERT INTO user_profiles SELECT * FROM user_profiles_backup`);
  db.exec(`DROP TABLE user_profiles_backup`);

  // Recreate original indexes
  db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_user_guild ON memories(user_id, guild_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_profiles_user_guild ON user_profiles(user_id, guild_id)`);
}
