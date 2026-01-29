/**
 * Migration: Create user_profiles table
 *
 * Stores AI-generated user profiles per guild with sections for
 * summary, personality, interests, and facts. Users can opt out
 * and edit their profiles via Discord modals.
 */

import type { Database } from 'bun:sqlite';

export function up(db: Database): void {
  db.exec(`
    CREATE TABLE user_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      guild_id TEXT NOT NULL,
      
      -- Profile sections (max ~2000 chars each for modal editing)
      summary TEXT,
      personality TEXT,
      interests TEXT,
      facts TEXT,
      
      -- User control
      opted_out INTEGER NOT NULL DEFAULT 0,
      
      -- Generation metadata
      messages_analyzed INTEGER DEFAULT 0,
      last_generated_at INTEGER,
      
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      
      UNIQUE(user_id, guild_id)
    );

    CREATE INDEX idx_user_profiles_user_guild ON user_profiles(user_id, guild_id);
    CREATE INDEX idx_user_profiles_opted_out ON user_profiles(opted_out);
  `);
}

export function down(db: Database): void {
  db.exec(`
    DROP INDEX IF EXISTS idx_user_profiles_opted_out;
    DROP INDEX IF EXISTS idx_user_profiles_user_guild;
    DROP TABLE IF EXISTS user_profiles;
  `);
}
