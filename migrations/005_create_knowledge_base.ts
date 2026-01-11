/**
 * Migration: Create knowledge base tables
 *
 * Guild-scoped knowledge entries with semantic search via embeddings.
 */

import type { Database } from 'bun:sqlite';

export function up(db: Database): void {
  // Main knowledge base table
  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_base (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      content TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      added_by INTEGER NOT NULL REFERENCES users(id),
      embedding BLOB,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_knowledge_guild ON knowledge_base(guild_id);
    CREATE INDEX IF NOT EXISTS idx_knowledge_added_by ON knowledge_base(added_by);
  `);
}

export function down(db: Database): void {
  db.exec(`
    DROP INDEX IF EXISTS idx_knowledge_added_by;
    DROP INDEX IF EXISTS idx_knowledge_guild;
    DROP TABLE IF EXISTS knowledge_base;
  `);
}
