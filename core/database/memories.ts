/**
 * Memory Repository - Manages user memories/preferences in the database
 */

import { embed, isEmbedderReady } from '../embedder';
import { cosineSimilarity, getDb } from './client';

export type MemoryType = 'preference' | 'fact' | 'instruction' | 'context' | 'profile_update';
export type MemorySource = 'explicit' | 'inferred';

export interface StoredMemory {
  id: number;
  user_id: number;
  guild_id: string;
  type: MemoryType;
  content: string;
  embedding: Buffer | null;
  source: MemorySource;
  is_global: number; // 0 = per-guild, 1 = global
  created_at: number;
  updated_at: number;
}

export interface CreateMemoryParams {
  userId: number;
  guildId: string;
  type: MemoryType;
  content: string;
  source?: MemorySource;
  isGlobal?: boolean;
}

export interface SimilarMemory extends StoredMemory {
  score: number;
}

/** Similarity threshold for deduplication */
const DEDUP_THRESHOLD = 0.77;

/** Max inferred memories per user per guild */
const MAX_INFERRED = 100;

/**
 * Save a memory, handling deduplication automatically
 * If a similar memory exists (same type, score > 0.85), it updates instead
 * Returns the memory ID (new or updated)
 */
export async function saveMemory(params: CreateMemoryParams): Promise<{ id: number; updated: boolean }> {
  const db = getDb();
  const now = Date.now();
  const source = params.source ?? 'explicit';
  const isGlobal = params.isGlobal ? 1 : 0;

  // Generate embedding for semantic matching
  let embedding: Float32Array | null = null;
  if (isEmbedderReady()) {
    embedding = await embed(params.content);
  }

  // Check for existing similar memory of same type
  if (embedding) {
    const similar = findSimilarMemory({
      userId: params.userId,
      guildId: params.guildId,
      embedding,
      type: params.type,
      threshold: DEDUP_THRESHOLD,
      isGlobal: params.isGlobal,
    });

    if (similar) {
      // Update existing memory instead of creating duplicate
      db.prepare(`
        UPDATE memories SET
          content = ?,
          embedding = ?,
          updated_at = ?
        WHERE id = ?
      `).run(params.content, embedding ? Buffer.from(embedding.buffer) : null, now, similar.id);
      return { id: similar.id, updated: true };
    }
  }

  // For inferred memories, check limit and prune if needed
  if (source === 'inferred') {
    // For global memories, check global count; for guild memories, check guild count
    const inferredCountQuery = isGlobal
      ? `SELECT COUNT(*) as count FROM memories WHERE user_id = ? AND is_global = 1 AND source = 'inferred'`
      : `SELECT COUNT(*) as count FROM memories WHERE user_id = ? AND guild_id = ? AND is_global = 0 AND source = 'inferred'`;

    const inferredCount = isGlobal
      ? (db.prepare<{ count: number }, [number]>(inferredCountQuery).get(params.userId)?.count ?? 0)
      : (db.prepare<{ count: number }, [number, string]>(inferredCountQuery).get(params.userId, params.guildId)
          ?.count ?? 0);

    if (inferredCount >= MAX_INFERRED) {
      // Delete oldest inferred memory
      const deleteQuery = isGlobal
        ? `DELETE FROM memories WHERE id = (
            SELECT id FROM memories 
            WHERE user_id = ? AND is_global = 1 AND source = 'inferred'
            ORDER BY updated_at ASC
            LIMIT 1
          )`
        : `DELETE FROM memories WHERE id = (
            SELECT id FROM memories 
            WHERE user_id = ? AND guild_id = ? AND is_global = 0 AND source = 'inferred'
            ORDER BY updated_at ASC
            LIMIT 1
          )`;

      if (isGlobal) {
        db.prepare(deleteQuery).run(params.userId);
      } else {
        db.prepare(deleteQuery).run(params.userId, params.guildId);
      }
    }
  }

  // Create new memory
  const result = db
    .prepare(`
    INSERT INTO memories (user_id, guild_id, type, content, embedding, source, is_global, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .run(
      params.userId,
      params.guildId,
      params.type,
      params.content,
      embedding ? Buffer.from(embedding.buffer) : null,
      source,
      isGlobal,
      now,
      now,
    );

  return { id: Number(result.lastInsertRowid), updated: false };
}

/**
 * Find a similar memory by embedding
 */
function findSimilarMemory(params: {
  userId: number;
  guildId: string;
  embedding: Float32Array;
  type?: MemoryType;
  threshold: number;
  isGlobal?: boolean;
}): StoredMemory | null {
  const db = getDb();
  const isGlobal = params.isGlobal ? 1 : 0;

  let query = `
    SELECT * FROM memories 
    WHERE user_id = ? AND is_global = ? AND embedding IS NOT NULL
  `;
  const queryParams: (number | string)[] = [params.userId, isGlobal];

  // For non-global memories, also filter by guild
  if (!params.isGlobal) {
    query += ` AND guild_id = ?`;
    queryParams.push(params.guildId);
  }

  if (params.type) {
    query += ` AND type = ?`;
    queryParams.push(params.type);
  }

  const memories = db.prepare<StoredMemory, (number | string)[]>(query).all(...queryParams);

  let bestMatch: StoredMemory | null = null;
  let bestScore = 0;

  for (const memory of memories) {
    if (!memory.embedding) continue;

    const storedEmbedding = new Float32Array(memory.embedding.buffer);
    const score = cosineSimilarity(params.embedding, storedEmbedding);

    if (score > params.threshold && score > bestScore) {
      bestMatch = memory;
      bestScore = score;
    }
  }

  return bestMatch;
}

/**
 * Get all memories for a user in a guild
 * Includes both guild-specific memories and global memories
 */
export function getMemories(userId: number, guildId: string | null): StoredMemory[] {
  const db = getDb();

  if (guildId) {
    // In a guild: return guild-specific memories + global memories
    return db
      .prepare<StoredMemory, [number, string, number]>(`
      SELECT * FROM memories 
      WHERE user_id = ? AND (guild_id = ? OR is_global = ?)
      ORDER BY updated_at DESC
    `)
      .all(userId, guildId, 1);
  } else {
    // In DMs: return only global memories + DM-specific memories
    return db
      .prepare<StoredMemory, [number, number, string]>(`
      SELECT * FROM memories 
      WHERE user_id = ? AND (is_global = ? OR guild_id = ?)
      ORDER BY updated_at DESC
    `)
      .all(userId, 1, 'dm');
  }
}

/**
 * Get memories for a specific scope only (guild-specific OR global, not both)
 */
export function getMemoriesByScope(userId: number, guildId: string | null, isGlobal: boolean): StoredMemory[] {
  const db = getDb();

  if (isGlobal) {
    return db
      .prepare<StoredMemory, [number, number]>(`
      SELECT * FROM memories 
      WHERE user_id = ? AND is_global = ?
      ORDER BY updated_at DESC
    `)
      .all(userId, 1);
  } else {
    const scope = guildId ?? 'dm';
    return db
      .prepare<StoredMemory, [number, string, number]>(`
      SELECT * FROM memories 
      WHERE user_id = ? AND guild_id = ? AND is_global = ?
      ORDER BY updated_at DESC
    `)
      .all(userId, scope, 0);
  }
}

/**
 * Get memories by type
 * Includes both guild-specific memories and global memories
 */
export function getMemoriesByType(userId: number, guildId: string | null, type: MemoryType): StoredMemory[] {
  const db = getDb();

  if (guildId) {
    return db
      .prepare<StoredMemory, [number, string, number, string]>(`
      SELECT * FROM memories 
      WHERE user_id = ? AND (guild_id = ? OR is_global = ?) AND type = ?
      ORDER BY updated_at DESC
    `)
      .all(userId, guildId, 1, type);
  } else {
    return db
      .prepare<StoredMemory, [number, number, string, string]>(`
      SELECT * FROM memories 
      WHERE user_id = ? AND (is_global = ? OR guild_id = ?) AND type = ?
      ORDER BY updated_at DESC
    `)
      .all(userId, 1, 'dm', type);
  }
}

/**
 * Search memories semantically
 * @param params.userId - User ID to search memories for
 * @param params.guildId - Guild ID to search memories in (null for DMs)
 * @param params.query - Search query text
 * @param params.limit - Maximum number of results (default: 5)
 * @param params.timeRangeMs - Optional time range in milliseconds to filter memories (e.g., 86400000 for last 24h). Undefined = no time filter (searches all memories)
 */
export async function searchMemories(params: {
  userId: number;
  guildId: string | null;
  query: string;
  limit?: number;
  timeRangeMs?: number;
}): Promise<SimilarMemory[]> {
  if (!isEmbedderReady()) return [];

  const db = getDb();
  const queryEmbedding = await embed(params.query);
  const limit = params.limit ?? 5;

  // Build query with optional time range filter
  // Include both guild-specific and global memories
  let query: string;
  const queryParams: (number | string)[] = [params.userId];

  if (params.guildId) {
    query = `
      SELECT * FROM memories 
      WHERE user_id = ? AND (guild_id = ? OR is_global = 1) AND embedding IS NOT NULL
    `;
    queryParams.push(params.guildId);
  } else {
    query = `
      SELECT * FROM memories 
      WHERE user_id = ? AND (is_global = 1 OR guild_id = 'dm') AND embedding IS NOT NULL
    `;
  }

  if (params.timeRangeMs !== undefined) {
    const cutoffTime = Date.now() - params.timeRangeMs;
    query += ` AND created_at > ?`;
    queryParams.push(cutoffTime);
  }

  const memories = db.prepare<StoredMemory, (number | string)[]>(query).all(...queryParams);

  const scored: SimilarMemory[] = [];

  for (const memory of memories) {
    if (!memory.embedding) continue;

    const storedEmbedding = new Float32Array(memory.embedding.buffer);
    const score = cosineSimilarity(queryEmbedding, storedEmbedding);

    scored.push({ ...memory, score });
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * Get memories for system prompt injection
 * Returns most relevant memories based on current message
 * Includes both guild-specific and global memories
 */
export async function getMemoriesForPrompt(params: {
  userId: number;
  guildId: string | null;
  currentMessage?: string;
  limit?: number;
}): Promise<StoredMemory[]> {
  const db = getDb();
  const limit = params.limit ?? 10;

  // If we have a current message and embedder is ready, do semantic search
  if (params.currentMessage && isEmbedderReady()) {
    const relevant = await searchMemories({
      userId: params.userId,
      guildId: params.guildId,
      query: params.currentMessage,
      limit,
    });

    // Filter to only reasonably relevant (score > 0.3)
    const filtered = relevant.filter((m) => m.score > 0.3);
    if (filtered.length > 0) {
      return filtered;
    }
  }

  // Fallback: return most recently updated memories (guild + global)
  if (params.guildId) {
    return db
      .prepare<StoredMemory, [number, string, number, number]>(`
      SELECT * FROM memories 
      WHERE user_id = ? AND (guild_id = ? OR is_global = ?)
      ORDER BY updated_at DESC
      LIMIT ?
    `)
      .all(params.userId, params.guildId, 1, limit);
  } else {
    return db
      .prepare<StoredMemory, [number, number, string, number]>(`
      SELECT * FROM memories 
      WHERE user_id = ? AND (is_global = ? OR guild_id = ?)
      ORDER BY updated_at DESC
      LIMIT ?
    `)
      .all(params.userId, 1, 'dm', limit);
  }
}

/**
 * Update a memory by ID
 */
export async function updateMemory(id: number, content: string): Promise<boolean> {
  const db = getDb();
  const now = Date.now();

  let embedding: Buffer | null = null;
  if (isEmbedderReady()) {
    const emb = await embed(content);
    embedding = Buffer.from(emb.buffer);
  }

  const result = db
    .prepare(`
    UPDATE memories SET content = ?, embedding = ?, updated_at = ?
    WHERE id = ?
  `)
    .run(content, embedding, now, id);

  return result.changes > 0;
}

/**
 * Delete a memory by ID
 */
export function deleteMemory(id: number): boolean {
  const db = getDb();
  const result = db.prepare(`DELETE FROM memories WHERE id = ?`).run(id);
  return result.changes > 0;
}

/**
 * Delete all memories for a user in a guild (guild-specific only, not global)
 */
export function clearMemories(userId: number, guildId: string): number {
  const db = getDb();
  const result = db
    .prepare(`
    DELETE FROM memories WHERE user_id = ? AND guild_id = ? AND is_global = 0
  `)
    .run(userId, guildId);
  return result.changes;
}

/**
 * Delete all global memories for a user
 */
export function clearGlobalMemories(userId: number): number {
  const db = getDb();
  const result = db
    .prepare(`
    DELETE FROM memories WHERE user_id = ? AND is_global = 1
  `)
    .run(userId);
  return result.changes;
}

/**
 * Delete all inferred memories for a user in a guild (guild-specific only)
 * Used after profile generation to clean up incorporated memories
 */
export function deleteInferredMemories(userId: number, guildId: string): number {
  const db = getDb();
  const result = db.run(
    `DELETE FROM memories WHERE user_id = ? AND guild_id = ? AND is_global = 0 AND source = 'inferred'`,
    [userId, guildId],
  );
  return result.changes;
}

/**
 * Delete all global inferred memories for a user
 */
export function deleteGlobalInferredMemories(userId: number): number {
  const db = getDb();
  const result = db.run(`DELETE FROM memories WHERE user_id = ? AND is_global = 1 AND source = 'inferred'`, [userId]);
  return result.changes;
}

/**
 * Delete all memories of a specific type for a user in a guild (guild-specific only)
 */
export function deleteMemoriesByType(userId: number, guildId: string, type: MemoryType): number {
  const db = getDb();
  const result = db.run(`DELETE FROM memories WHERE user_id = ? AND guild_id = ? AND is_global = 0 AND type = ?`, [
    userId,
    guildId,
    type,
  ]);
  return result.changes;
}

/**
 * Get memory count for a user in a guild
 * Returns counts for guild-specific memories only
 */
export function getMemoryCount(
  userId: number,
  guildId: string | null,
): { explicit: number; inferred: number; global: number } {
  const db = getDb();
  const scope = guildId ?? 'dm';

  // Count guild/dm-specific memories
  const scopeResult = db
    .prepare<{ explicit: number; inferred: number }, [number, string, number]>(
      `
    SELECT 
      SUM(CASE WHEN source = 'explicit' THEN 1 ELSE 0 END) as explicit,
      SUM(CASE WHEN source = 'inferred' THEN 1 ELSE 0 END) as inferred
    FROM memories WHERE user_id = ? AND guild_id = ? AND is_global = ?
  `,
    )
    .get(userId, scope, 0);

  // Count global memories
  const globalResult = db
    .prepare<{ count: number }, [number, number]>(
      `
    SELECT COUNT(*) as count FROM memories WHERE user_id = ? AND is_global = ?
  `,
    )
    .get(userId, 1);

  return {
    explicit: scopeResult?.explicit ?? 0,
    inferred: scopeResult?.inferred ?? 0,
    global: globalResult?.count ?? 0,
  };
}

/**
 * Format memories for system prompt injection
 */
export function formatMemoriesForPrompt(memories: StoredMemory[], userName: string): string {
  if (memories.length === 0) return '';

  const grouped: Record<MemoryType, string[]> = {
    preference: [],
    fact: [],
    instruction: [],
    context: [],
    profile_update: [],
  };

  for (const memory of memories) {
    grouped[memory.type].push(memory.content);
  }

  const lines: string[] = [`# User Context for @${userName}`];

  if (grouped.instruction.length > 0) {
    lines.push('\n## Instructions');
    lines.push(...grouped.instruction.map((m) => `- ${m}`));
  }

  if (grouped.preference.length > 0) {
    lines.push('\n## Preferences');
    lines.push(...grouped.preference.map((m) => `- ${m}`));
  }

  if (grouped.fact.length > 0) {
    lines.push('\n## Facts');
    lines.push(...grouped.fact.map((m) => `- ${m}`));
  }

  if (grouped.context.length > 0) {
    lines.push('\n## Current Context');
    lines.push(...grouped.context.map((m) => `- ${m}`));
  }

  return lines.join('\n');
}

// =============================================================================
// Migration Functions (for /migrate command)
// =============================================================================

/**
 * Migrate memories from guild-specific to global
 * Returns the number of memories migrated
 */
export function migrateMemoriesToGlobal(userId: number, fromGuildId: string): number {
  const db = getDb();
  const result = db
    .prepare(`
    UPDATE memories 
    SET is_global = 1, guild_id = 'global'
    WHERE user_id = ? AND guild_id = ? AND is_global = 0
  `)
    .run(userId, fromGuildId);
  return result.changes;
}

/**
 * Migrate memories from one guild to another
 * Returns the number of memories migrated
 */
export function migrateMemoriesToGuild(userId: number, fromGuildId: string, toGuildId: string): number {
  const db = getDb();
  const result = db
    .prepare(`
    UPDATE memories 
    SET guild_id = ?
    WHERE user_id = ? AND guild_id = ? AND is_global = 0
  `)
    .run(toGuildId, userId, fromGuildId);
  return result.changes;
}

/**
 * Get count of memories in a specific guild (non-global only)
 */
export function getGuildMemoryCount(userId: number, guildId: string): number {
  const db = getDb();
  const result = db
    .prepare<{ count: number }, [number, string, number]>(`
    SELECT COUNT(*) as count FROM memories 
    WHERE user_id = ? AND guild_id = ? AND is_global = ?
  `)
    .get(userId, guildId, 0);
  return result?.count ?? 0;
}

/**
 * Get count of global memories for a user
 */
export function getGlobalMemoryCount(userId: number): number {
  const db = getDb();
  const result = db
    .prepare<{ count: number }, [number, number]>(`
    SELECT COUNT(*) as count FROM memories 
    WHERE user_id = ? AND is_global = ?
  `)
    .get(userId, 1);
  return result?.count ?? 0;
}
