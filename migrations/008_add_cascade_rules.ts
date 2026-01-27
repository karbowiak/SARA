/**
 * Migration: Add CASCADE rules to foreign keys
 *
 * SQLite doesn't support ALTER TABLE for foreign key changes,
 * so we need to recreate tables with proper CASCADE rules.
 *
 * Tables affected:
 * - messages (user_id → users)
 * - memories (user_id → users)
 * - user_roles (user_id → users)
 * - reminders (user_id, original_reminder_id → reminders)
 * - knowledge_base (added_by → users)
 */

import type { Database } from 'bun:sqlite';

export function up(db: Database): void {
  // Backup existing data before recreating tables
  const tablesToRecreate = ['messages', 'memories', 'user_roles', 'reminders', 'knowledge_base'];
  const backups = new Map<string, any[]>();

  for (const table of tablesToRecreate) {
    try {
      const rows = db.query(`SELECT * FROM ${table}`).all();
      backups.set(table, rows);
    } catch (error) {
      console.warn(`Failed to backup ${table}: ${error}`);
    }
  }

  // Drop old tables
  for (const table of tablesToRecreate) {
    db.exec(`DROP TABLE IF EXISTS ${table}`);
  }

  // Recreate tables with CASCADE rules
  db.exec(`
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL,
      platform_message_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      channel_id TEXT NOT NULL,
      guild_id TEXT,
      content TEXT NOT NULL,
      embedding BLOB,
      created_at INTEGER NOT NULL,

      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
      UNIQUE(platform, platform_message_id)
    );
  `);

  db.exec(`
    CREATE TABLE memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      guild_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('preference', 'fact', 'instruction', 'context')),
      content TEXT NOT NULL,
      embedding BLOB,
      source TEXT NOT NULL CHECK(source IN ('manual', 'inferred')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,

      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE
    );
  `);

  db.exec(`
    CREATE TABLE user_roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      guild_id TEXT NOT NULL,
      role_id TEXT NOT NULL,

      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE
    );
  `);

  db.exec(`
    CREATE TABLE reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      guild_id TEXT,
      channel_id TEXT,
      platform TEXT NOT NULL DEFAULT 'discord',
      message TEXT NOT NULL,
      trigger_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      delivered_at INTEGER,
      cancelled_at INTEGER,
      repeat_interval TEXT CHECK(repeat_interval IN ('daily', 'weekly', 'monthly')),
      repeat_end_at INTEGER,
      snooze_count INTEGER NOT NULL DEFAULT 0,
      original_reminder_id INTEGER,

      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
      FOREIGN KEY (original_reminder_id) REFERENCES reminders(id) ON DELETE CASCADE ON UPDATE CASCADE
    );
  `);

  db.exec(`
    CREATE TABLE knowledge_base (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      content TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      added_by INTEGER NOT NULL,
      embedding BLOB,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,

      FOREIGN KEY (added_by) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE
    );
  `);

  // Restore data
  for (const [table, rows] of backups) {
    try {
      if (rows.length === 0) continue;

      const columns = Object.keys(rows[0] as Record<string, unknown>);
      const placeholders = columns.fill('?').join(', ');
      const columnsList = columns.join(', ');
      const values = rows.map((row) => Object.values(row));

      db.prepare(`INSERT INTO ${table} (${columnsList}) VALUES (${placeholders})`).run(...values);
    } catch (error) {
      console.warn(`Failed to restore ${table}: ${error}`);
    }
  }

  // Clean up orphaned records
  cleanupOrphanedRecords(db);

  console.info('CASCADE rules added and data restored successfully');
}

export function down(db: Database): void {
  // Revert to non-CASCADE behavior
  // We need to recreate tables without CASCADE rules
  const tablesToRecreate = ['messages', 'memories', 'user_roles', 'reminders', 'knowledge_base'];

  // Backup existing data before reverting
  const backups = new Map<string, any[]>();
  for (const table of tablesToRecreate) {
    try {
      const rows = db.query(`SELECT * FROM ${table}`).all();
      backups.set(table, rows);
    } catch (error) {
      console.warn(`Failed to backup ${table}: ${error}`);
    }
  }

  // Drop old tables
  for (const table of tablesToRecreate) {
    db.exec(`DROP TABLE IF EXISTS ${table}`);
  }

  // Recreate tables without CASCADE rules
  db.exec(`
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL,
      platform_message_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      channel_id TEXT NOT NULL,
      guild_id TEXT,
      content TEXT NOT NULL,
      embedding BLOB,
      created_at INTEGER NOT NULL,
      UNIQUE(platform, platform_message_id)
    );
  `);

  db.exec(`
    CREATE TABLE memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      guild_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('preference', 'fact', 'instruction', 'context')),
      content TEXT NOT NULL,
      embedding BLOB,
      source TEXT NOT NULL CHECK(source IN ('manual', 'inferred')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE user_roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      guild_id TEXT NOT NULL,
      role_id TEXT NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      guild_id TEXT,
      channel_id TEXT,
      platform TEXT NOT NULL DEFAULT 'discord',
      message TEXT NOT NULL,
      trigger_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      delivered_at INTEGER,
      cancelled_at INTEGER,
      repeat_interval TEXT CHECK(repeat_interval IN ('daily', 'weekly', 'monthly')),
      repeat_end_at INTEGER,
      snooze_count INTEGER NOT NULL DEFAULT 0,
      original_reminder_id INTEGER
    );
  `);

  db.exec(`
    CREATE TABLE knowledge_base (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      content TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      added_by INTEGER NOT NULL,
      embedding BLOB,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  // Restore data
  for (const [table, rows] of backups) {
    try {
      if (rows.length === 0) continue;

      const columns = Object.keys(rows[0] as Record<string, unknown>);
      const placeholders = columns.fill('?').join(', ');
      const columnsList = columns.join(', ');
      const values = rows.map((row) => Object.values(row));

      db.prepare(`INSERT INTO ${table} (${columnsList}) VALUES (${placeholders})`).run(...values);
    } catch (error) {
      console.warn(`Failed to restore ${table}: ${error}`);
    }
  }

  console.info('CASCADE rules removed (data preserved)');
}

function cleanupOrphanedRecords(db: Database): void {
  const users = db.query(`SELECT id FROM users`).all() as { id: number }[];
  const userIds = users.map((u) => u.id);

  // Delete messages without valid users
  db.exec(`
    DELETE FROM messages
    WHERE user_id NOT IN (${userIds.join(',')})
  `);

  // Delete memories without valid users
  db.exec(`
    DELETE FROM memories
    WHERE user_id NOT IN (${userIds.join(',')})
  `);

  // Delete user_roles without valid users
  db.exec(`
    DELETE FROM user_roles
    WHERE user_id NOT IN (${userIds.join(',')})
  `);

  // Delete reminders without valid users
  db.exec(`
    DELETE FROM reminders
    WHERE user_id NOT IN (${userIds.join(',')})
      OR original_reminder_id NOT IN (SELECT id FROM reminders WHERE id NOT IN (SELECT original_reminder_id FROM reminders))
  `);

  // Delete knowledge_base without valid added_by
  db.exec(`
    DELETE FROM knowledge_base
    WHERE added_by NOT IN (${userIds.join(',')})
  `);

  console.info('Cleaned orphaned records');
}
