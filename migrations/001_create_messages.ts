/**
 * Migration: Create core tables
 *
 * - users: Track all users across platforms
 * - messages: Store messages with embeddings for semantic search
 * - memories: Store user memories/preferences per guild
 */

import type { Database } from 'bun:sqlite';

export function up(db: Database): void {
  // Users table - single source of truth for user data
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL,
      platform_user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      display_name TEXT,
      avatar_url TEXT,
      is_bot INTEGER NOT NULL DEFAULT 0,
      first_seen_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      last_message_at INTEGER,
      message_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      
      UNIQUE(platform, platform_user_id)
    );

    CREATE INDEX idx_users_platform ON users(platform, platform_user_id);
    CREATE INDEX idx_users_last_seen ON users(last_seen_at DESC);
  `);

  // Messages table - stores all messages with embeddings
  db.exec(`
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      platform TEXT NOT NULL,
      platform_message_id TEXT NOT NULL,
      guild_id TEXT,
      channel_id TEXT NOT NULL,
      content TEXT NOT NULL,
      embedding BLOB,
      created_at INTEGER NOT NULL,
      
      UNIQUE(platform, platform_message_id)
    );

    CREATE INDEX idx_messages_channel ON messages(channel_id);
    CREATE INDEX idx_messages_user ON messages(user_id);
    CREATE INDEX idx_messages_created ON messages(created_at DESC);
    CREATE INDEX idx_messages_guild ON messages(guild_id);
    CREATE INDEX idx_messages_platform ON messages(platform, platform_message_id);
  `);

  // Memories table - stores user preferences/facts per guild
  db.exec(`
    CREATE TABLE memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      guild_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('preference', 'fact', 'instruction', 'context')),
      content TEXT NOT NULL,
      embedding BLOB,
      source TEXT NOT NULL DEFAULT 'explicit' CHECK(source IN ('explicit', 'inferred')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX idx_memories_user_guild ON memories(user_id, guild_id);
    CREATE INDEX idx_memories_type ON memories(type);
    CREATE INDEX idx_memories_source ON memories(source);
  `);
}

export function down(db: Database): void {
  db.exec(`
    DROP TABLE IF EXISTS memories;
    DROP TABLE IF EXISTS messages;
    DROP TABLE IF EXISTS users;
  `);
}
