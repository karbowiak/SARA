/**
 * Migration: Add source message reference to reminders
 *
 * Adds a column to store the original message ID that triggered the reminder,
 * allowing us to link back to the context.
 */

import type { Database } from 'bun:sqlite';

export function up(db: Database): void {
  db.exec(`
    ALTER TABLE reminders ADD COLUMN source_message_id TEXT;
  `);
}

export function down(_db: Database): void {
  // SQLite doesn't support DROP COLUMN easily, so we'd need to recreate the table
  // For simplicity, we'll just leave the column
}
