/**
 * Migration: Fix missing source_message_id column in reminders table
 *
 * This migration is idempotent - it can be run multiple times safely.
 * It checks if the column exists before attempting to add it.
 */

import type { Database } from 'bun:sqlite';

export function up(db: Database): void {
  const columnExists = db
    .prepare(`
    SELECT COUNT(*) as count 
    FROM pragma_table_info('reminders') 
    WHERE name = 'source_message_id'
  `)
    .get() as { count: number };

  if (columnExists.count === 0) {
    db.exec('ALTER TABLE reminders ADD COLUMN source_message_id TEXT;');
  }
}

export function down(_db: Database): void {}
