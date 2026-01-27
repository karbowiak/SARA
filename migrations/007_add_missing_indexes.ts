/**
 * Migration: Add missing database indexes for performance
 *
 * Adds composite and partial indexes to optimize frequently executed queries.
 * Improves performance for:
 * - Channel message retrieval
 * - Bot message filtering
 * - Vector search on messages with embeddings
 * - Memory queries by user/guild/source
 * - Knowledge base lookups
 * - Reminder snooze operations
 * - Stream monitoring
 */

import type { Database } from 'bun:sqlite';

export function up(db: Database): void {
  // 1. Composite index for channel messages with time ordering
  // Used by: core/database/messages.ts - WHERE channel_id = ? ORDER BY created_at DESC
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_channel_created
    ON messages(channel_id, created_at DESC);
  `);

  // 2. Partial index for bot user filtering
  // Used by: core/database/messages.ts - JOIN users WHERE u.is_bot = 0
  // Partial index on users table (is_bot is in users, not messages)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_users_not_bot
    ON users(id) WHERE is_bot = 0;
  `);

  // 3. Partial index for vector search (messages with embeddings)
  // Used by: core/database/messages.ts - WHERE embedding IS NOT NULL
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_with_embeddings
    ON messages(created_at DESC) WHERE embedding IS NOT NULL;
  `);

  // 4. Composite index for memory queries
  // Used by: core/database/memories.ts - WHERE user_id = ? AND guild_id = ? AND source = 'inferred'
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_memories_user_guild_source
    ON memories(user_id, guild_id, source);
  `);

  // 5. Composite index for memory updates by guild
  // Used by: core/database/memories.ts - ORDER BY updated_at DESC
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_memories_updated_guild
    ON memories(guild_id, updated_at DESC);
  `);

  // 6. Composite index for knowledge base by guild and updated time
  // Used by: core/database/knowledge.ts - WHERE guild_id = ? ORDER BY updated_at DESC
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_knowledge_guild_updated
    ON knowledge_base(guild_id, updated_at DESC);
  `);

  // 7. Partial index for unembedded knowledge entries
  // Used by: core/database/knowledge.ts - WHERE embedding IS NULL
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_knowledge_unembedded
    ON knowledge_base(created_at) WHERE embedding IS NULL;
  `);

  // 8. Index for reminder snooze operations
  // Used by: reminders WHERE original_reminder_id = ?
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_reminders_original
    ON reminders(original_reminder_id);
  `);

  // 9. Composite index for stream monitoring by guild and live status
  // Used by: streams WHERE guild_id = ? AND is_live = 1
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_streams_guild_live
    ON streams(guild_id, is_live);
  `);
}

export function down(db: Database): void {
  db.exec('DROP INDEX IF EXISTS idx_messages_channel_created');
  db.exec('DROP INDEX IF EXISTS idx_users_not_bot');
  db.exec('DROP INDEX IF EXISTS idx_messages_with_embeddings');
  db.exec('DROP INDEX IF EXISTS idx_memories_user_guild_source');
  db.exec('DROP INDEX IF EXISTS idx_memories_updated_guild');
  db.exec('DROP INDEX IF EXISTS idx_knowledge_guild_updated');
  db.exec('DROP INDEX IF EXISTS idx_knowledge_unembedded');
  db.exec('DROP INDEX IF EXISTS idx_reminders_original');
  db.exec('DROP INDEX IF EXISTS idx_streams_guild_live');
}
