/**
 * Migration: Add profile_update memory type
 *
 * Adds 'profile_update' to the memory type constraint to support storing
 * profile generation events as memories for context in AI conversations.
 *
 * SQLite doesn't support ALTER TABLE to modify CHECK constraints, so we
 * recreate the table with the updated constraint.
 */

import type { Database } from 'bun:sqlite';

export function up(db: Database): void {
  // Backup existing data
  const rows = db.query(`SELECT * FROM memories`).all() as Record<string, unknown>[];

  // Drop the table
  db.exec(`DROP TABLE IF EXISTS memories`);

  // Recreate with updated CHECK constraint including 'profile_update'
  db.exec(`
    CREATE TABLE memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      guild_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('preference', 'fact', 'instruction', 'context', 'profile_update')),
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
  if (rows.length > 0) {
    const firstRow = rows[0]!;
    const columns = Object.keys(firstRow);
    const placeholders = new Array(columns.length).fill('?').join(', ');
    const columnsList = columns.join(', ');

    for (const row of rows) {
      const values = Object.values(row) as Array<string | number | Buffer | null>;
      db.prepare(`INSERT INTO memories (${columnsList}) VALUES (${placeholders})`).run(...values);
    }
  }

  console.info('Added profile_update to memory type constraint');
}

export function down(db: Database): void {
  // Backup existing data (excluding profile_update type)
  const rows = db.query(`SELECT * FROM memories WHERE type != 'profile_update'`).all() as Record<string, unknown>[];

  // Count removed rows for logging
  const removedCount = db.query(`SELECT COUNT(*) as count FROM memories WHERE type = 'profile_update'`).get() as {
    count: number;
  };

  // Drop the table
  db.exec(`DROP TABLE IF EXISTS memories`);

  // Recreate with original CHECK constraint (without profile_update)
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

  // Restore data (without profile_update entries)
  if (rows.length > 0) {
    const firstRow = rows[0]!;
    const columns = Object.keys(firstRow);
    const placeholders = new Array(columns.length).fill('?').join(', ');
    const columnsList = columns.join(', ');

    for (const row of rows) {
      const values = Object.values(row) as Array<string | number | Buffer | null>;
      db.prepare(`INSERT INTO memories (${columnsList}) VALUES (${placeholders})`).run(...values);
    }
  }

  if (removedCount.count > 0) {
    console.info(`Removed ${removedCount.count} profile_update memories during rollback`);
  }
  console.info('Reverted to original memory type constraint (without profile_update)');
}
