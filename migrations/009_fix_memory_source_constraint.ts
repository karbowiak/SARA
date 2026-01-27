/**
 * Migration: Fix memory source constraint
 *
 * Reverts the incorrect change in migration 008 that changed the source
 * column CHECK constraint from 'explicit'/'inferred' to 'manual'/'inferred'.
 * The codebase uses 'explicit' throughout, so the schema must match.
 *
 * This migration recreates the memories table with the correct constraint
 * and restores the data that couldn't be restored in migration 008.
 */

import type { Database } from 'bun:sqlite';

export function up(db: Database): void {
  // Backup existing data
  const rows = db.query(`SELECT * FROM memories`).all() as any[];
  const backups = new Map<string, any[]>();
  backups.set('memories', rows);

  // Drop the table
  db.exec(`DROP TABLE IF EXISTS memories`);

  // Recreate with correct CHECK constraint
  db.exec(`
    CREATE TABLE memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      guild_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('preference', 'fact', 'instruction', 'context')),
      content TEXT NOT NULL,
      embedding BLOB,
      source TEXT NOT NULL CHECK(source IN ('explicit', 'inferred')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,

      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE
    );

    CREATE INDEX idx_memories_user_guild ON memories(user_id, guild_id);
    CREATE INDEX idx_memories_type ON memories(type);
    CREATE INDEX idx_memories_source ON memories(source);
  `);

  // Restore data
  const rowsToRestore = backups.get('memories') || [];
  if (rowsToRestore.length > 0) {
    const columns = Object.keys(rowsToRestore[0] as Record<string, unknown>);
    const placeholders = new Array(columns.length).fill('?').join(', ');
    const columnsList = columns.join(', ');

    for (const row of rowsToRestore) {
      const values = Object.values(row) as Array<string | number | Buffer | null>;
      db.prepare(`INSERT INTO memories (${columnsList}) VALUES (${placeholders})`).run(...values);
    }
  }

  console.info('Memory source constraint fixed to (explicit, inferred)');
}

export function down(db: Database): void {
  // Revert to the incorrect constraint (for rollback purposes)
  const rows = db.query(`SELECT * FROM memories`).all() as any[];
  const backups = new Map<string, any[]>();
  backups.set('memories', rows);

  db.exec(`DROP TABLE IF EXISTS memories`);

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

    CREATE INDEX idx_memories_user_guild ON memories(user_id, guild_id);
    CREATE INDEX idx_memories_type ON memories(type);
    CREATE INDEX idx_memories_source ON memories(source);
  `);

  const rowsToRestore = backups.get('memories') || [];
  if (rowsToRestore.length > 0) {
    const columns = Object.keys(rowsToRestore[0] as Record<string, unknown>);
    const placeholders = new Array(columns.length).fill('?').join(', ');
    const columnsList = columns.join(', ');

    for (const row of rowsToRestore) {
      const values = Object.values(row) as Array<string | number | Buffer | null>;
      db.prepare(`INSERT INTO memories (${columnsList}) VALUES (${placeholders})`).run(...values);
    }
  }

  console.info('Reverted to (manual, inferred) constraint');
}
