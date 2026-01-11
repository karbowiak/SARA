/**
 * Memory Repository - Manages user memories/preferences in the database
 */

import { embed, isEmbedderReady } from '../embedder';
import { getDb } from './client';

export type MemoryType = 'preference' | 'fact' | 'instruction' | 'context';
export type MemorySource = 'explicit' | 'inferred';

export interface StoredMemory {
  id: number;
  user_id: number;
  guild_id: string;
  type: MemoryType;
  content: string;
  embedding: Buffer | null;
  source: MemorySource;
  created_at: number;
  updated_at: number;
}

export interface CreateMemoryParams {
  userId: number;
  guildId: string;
  type: MemoryType;
  content: string;
  source?: MemorySource;
}

export interface SimilarMemory extends StoredMemory {
  score: number;
}

/** Similarity threshold for deduplication */
const DEDUP_THRESHOLD = 0.85;

/** Max inferred memories per user per guild */
const MAX_INFERRED = 10;

/**
 * Save a memory, handling deduplication automatically
 * If a similar memory exists (same type, score > 0.85), it updates instead
 * Returns the memory ID (new or updated)
 */
export async function saveMemory(params: CreateMemoryParams): Promise<{ id: number; updated: boolean }> {
  const db = getDb();
  const now = Date.now();
  const source = params.source ?? 'explicit';

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
    const inferredCount =
      db
        .prepare<{ count: number }, [number, string]>(`
      SELECT COUNT(*) as count FROM memories 
      WHERE user_id = ? AND guild_id = ? AND source = 'inferred'
    `)
        .get(params.userId, params.guildId)?.count ?? 0;

    if (inferredCount >= MAX_INFERRED) {
      // Delete oldest inferred memory
      db.prepare(`
        DELETE FROM memories WHERE id = (
          SELECT id FROM memories 
          WHERE user_id = ? AND guild_id = ? AND source = 'inferred'
          ORDER BY updated_at ASC
          LIMIT 1
        )
      `).run(params.userId, params.guildId);
    }
  }

  // Create new memory
  const result = db
    .prepare(`
    INSERT INTO memories (user_id, guild_id, type, content, embedding, source, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .run(
      params.userId,
      params.guildId,
      params.type,
      params.content,
      embedding ? Buffer.from(embedding.buffer) : null,
      source,
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
}): StoredMemory | null {
  const db = getDb();

  let query = `
    SELECT * FROM memories 
    WHERE user_id = ? AND guild_id = ? AND embedding IS NOT NULL
  `;
  const queryParams: (number | string)[] = [params.userId, params.guildId];

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
 */
export function getMemories(userId: number, guildId: string): StoredMemory[] {
  const db = getDb();
  return db
    .prepare<StoredMemory, [number, string]>(`
    SELECT * FROM memories 
    WHERE user_id = ? AND guild_id = ?
    ORDER BY updated_at DESC
  `)
    .all(userId, guildId);
}

/**
 * Get memories by type
 */
export function getMemoriesByType(userId: number, guildId: string, type: MemoryType): StoredMemory[] {
  const db = getDb();
  return db
    .prepare<StoredMemory, [number, string, string]>(`
    SELECT * FROM memories 
    WHERE user_id = ? AND guild_id = ? AND type = ?
    ORDER BY updated_at DESC
  `)
    .all(userId, guildId, type);
}

/**
 * Search memories semantically
 */
export async function searchMemories(params: {
  userId: number;
  guildId: string;
  query: string;
  limit?: number;
}): Promise<SimilarMemory[]> {
  if (!isEmbedderReady()) return [];

  const db = getDb();
  const queryEmbedding = await embed(params.query);
  const limit = params.limit ?? 5;

  const memories = db
    .prepare<StoredMemory, [number, string]>(`
    SELECT * FROM memories 
    WHERE user_id = ? AND guild_id = ? AND embedding IS NOT NULL
  `)
    .all(params.userId, params.guildId);

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
 */
export async function getMemoriesForPrompt(params: {
  userId: number;
  guildId: string;
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

  // Fallback: return most recently updated memories
  return db
    .prepare<StoredMemory, [number, string, number]>(`
    SELECT * FROM memories 
    WHERE user_id = ? AND guild_id = ?
    ORDER BY updated_at DESC
    LIMIT ?
  `)
    .all(params.userId, params.guildId, limit);
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
 * Delete all memories for a user in a guild
 */
export function clearMemories(userId: number, guildId: string): number {
  const db = getDb();
  const result = db
    .prepare(`
    DELETE FROM memories WHERE user_id = ? AND guild_id = ?
  `)
    .run(userId, guildId);
  return result.changes;
}

/**
 * Get memory count for a user in a guild
 */
export function getMemoryCount(userId: number, guildId: string): { explicit: number; inferred: number } {
  const db = getDb();

  const explicit =
    db
      .prepare<{ count: number }, [number, string]>(`
    SELECT COUNT(*) as count FROM memories 
    WHERE user_id = ? AND guild_id = ? AND source = 'explicit'
  `)
      .get(userId, guildId)?.count ?? 0;

  const inferred =
    db
      .prepare<{ count: number }, [number, string]>(`
    SELECT COUNT(*) as count FROM memories 
    WHERE user_id = ? AND guild_id = ? AND source = 'inferred'
  `)
      .get(userId, guildId)?.count ?? 0;

  return { explicit, inferred };
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

/**
 * Cosine similarity between two vectors
 */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}
