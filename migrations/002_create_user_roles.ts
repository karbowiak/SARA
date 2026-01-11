/**
 * Migration: Create user_roles table
 *
 * Caches user role information per guild with automatic refresh after 24h.
 * Stores both raw role IDs and resolved group names from config.
 */

import type { Database } from 'bun:sqlite';

export function up(db: Database): void {
  db.exec(`
    CREATE TABLE user_roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      guild_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      role_ids TEXT NOT NULL DEFAULT '[]',
      resolved_groups TEXT NOT NULL DEFAULT '[]',
      updated_at INTEGER NOT NULL,
      
      UNIQUE(user_id, guild_id, platform)
    );
    
    CREATE INDEX idx_user_roles_lookup ON user_roles(user_id, guild_id, platform);
    CREATE INDEX idx_user_roles_updated ON user_roles(updated_at);
  `);
}

export function down(db: Database): void {
  db.exec('DROP TABLE IF EXISTS user_roles');
}
