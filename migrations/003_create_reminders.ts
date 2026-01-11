/**
 * Migration: Create reminders table
 *
 * Stores user reminders with support for:
 * - One-time and recurring reminders
 * - Snooze tracking
 * - Soft cancellation
 */

import type { Database } from 'bun:sqlite';

export function up(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      
      -- User and context
      user_id INTEGER NOT NULL REFERENCES users(id),
      guild_id TEXT,
      channel_id TEXT,
      platform TEXT NOT NULL DEFAULT 'discord',
      
      -- Reminder content
      message TEXT NOT NULL,
      
      -- Timing (all UTC timestamps)
      trigger_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      delivered_at INTEGER,
      cancelled_at INTEGER,
      
      -- Recurring reminders
      repeat_interval TEXT CHECK(repeat_interval IN ('daily', 'weekly', 'monthly')),
      repeat_end_at INTEGER,
      
      -- Snooze tracking
      snooze_count INTEGER NOT NULL DEFAULT 0,
      original_reminder_id INTEGER REFERENCES reminders(id)
    );
    
    -- Index for efficient due reminder queries
    CREATE INDEX IF NOT EXISTS idx_reminders_due 
      ON reminders(trigger_at) 
      WHERE delivered_at IS NULL AND cancelled_at IS NULL;
    
    -- Index for user lookups
    CREATE INDEX IF NOT EXISTS idx_reminders_user 
      ON reminders(user_id, delivered_at, cancelled_at);
  `);
}

export function down(db: Database): void {
  db.exec(`
    DROP INDEX IF EXISTS idx_reminders_user;
    DROP INDEX IF EXISTS idx_reminders_due;
    DROP TABLE IF EXISTS reminders;
  `);
}
