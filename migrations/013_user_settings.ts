/**
 * Migration: Create user_settings table
 *
 * Stores user-specific settings as key-value pairs with JSON values.
 * Each user can have multiple settings, with unique keys per user.
 */

import type { Database } from 'bun:sqlite';

export function up(db: Database): void {
  db.exec(`
    CREATE TABLE user_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      setting_key TEXT NOT NULL,
      setting_value TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      
      UNIQUE(user_id, setting_key)
    );

    CREATE INDEX idx_user_settings_user_id ON user_settings(user_id);
  `);
}

export function down(db: Database): void {
  db.exec(`
    DROP INDEX IF EXISTS idx_user_settings_user_id;
    DROP TABLE IF EXISTS user_settings;
  `);
}
