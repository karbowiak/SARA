/**
 * Knowledge Repository - Guild-scoped knowledge base with semantic search
 *
 * Unlike memories (user-scoped), knowledge is shared across the entire guild.
 * Supports tags for organization and semantic search via embeddings.
 */

import { embed, isEmbedderReady } from '../embedder';
import { cosineSimilarity, getDb } from './client';

export interface KnowledgeEntry {
  id: number;
  guild_id: string;
  content: string;
  tags: string[];
  added_by: number;
  embedding: Buffer | null;
  created_at: number;
  updated_at: number;
}

export interface KnowledgeWithScore extends KnowledgeEntry {
  score: number;
}

export interface CreateKnowledgeParams {
  guildId: string;
  content: string;
  tags?: string[];
  addedBy: number;
}

/**
 * Add a knowledge entry
 * Embedding is generated immediately if embedder is ready
 */
export async function addKnowledge(params: CreateKnowledgeParams): Promise<KnowledgeEntry> {
  const db = getDb();
  const now = Date.now();
  const tags = params.tags ?? [];

  // Generate embedding
  let embedding: Buffer | null = null;
  if (isEmbedderReady()) {
    try {
      const emb = await embed(params.content);
      embedding = Buffer.from(emb.buffer);
    } catch (error) {
      console.error('Failed to generate embedding for knowledge:', error);
    }
  }

  const result = db
    .prepare(
      `
    INSERT INTO knowledge_base (guild_id, content, tags, added_by, embedding, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `,
    )
    .run(params.guildId, params.content, JSON.stringify(tags), params.addedBy, embedding, now, now);

  return {
    id: Number(result.lastInsertRowid),
    guild_id: params.guildId,
    content: params.content,
    tags,
    added_by: params.addedBy,
    embedding,
    created_at: now,
    updated_at: now,
  };
}

/**
 * Get a knowledge entry by ID
 */
export function getKnowledge(id: number): KnowledgeEntry | null {
  const db = getDb();
  const row = db
    .prepare<KnowledgeEntry & { tags: string }, [number]>(
      `
    SELECT * FROM knowledge_base WHERE id = ?
  `,
    )
    .get(id);

  if (!row) return null;

  return {
    ...row,
    tags: JSON.parse(row.tags) as string[],
  };
}

/**
 * Get all knowledge entries for a guild
 */
export function getGuildKnowledge(guildId: string, options?: { tag?: string; limit?: number }): KnowledgeEntry[] {
  const db = getDb();
  const limit = options?.limit ?? 100;

  const rows = db
    .prepare<KnowledgeEntry & { tags: string }, [string, number]>(
      `
    SELECT * FROM knowledge_base 
    WHERE guild_id = ?
    ORDER BY updated_at DESC
    LIMIT ?
  `,
    )
    .all(guildId, limit);

  let entries = rows.map((row) => ({
    ...row,
    tags: JSON.parse(row.tags) as string[],
  }));

  // Filter by tag if specified
  if (options?.tag) {
    const tagLower = options.tag.toLowerCase();
    entries = entries.filter((e) => e.tags.some((t) => t.toLowerCase() === tagLower));
  }

  return entries;
}

/**
 * Search knowledge semantically
 * @param params.timeRangeMs - Optional time range in milliseconds. If provided, only returns entries created within this time range from now. Undefined = no time filter (knowledge persists indefinitely by default).
 */
export async function searchKnowledge(params: {
  guildId: string;
  query: string;
  limit?: number;
  tag?: string;
  timeRangeMs?: number;
}): Promise<KnowledgeWithScore[]> {
  if (!isEmbedderReady()) {
    // Fallback to text search
    return textSearchKnowledge(params);
  }

  const db = getDb();
  const queryEmbedding = await embed(params.query);
  const limit = params.limit ?? 10;

  // Build query with optional time filter
  let query = `
    SELECT * FROM knowledge_base 
    WHERE guild_id = ? AND embedding IS NOT NULL
  `;
  const queryParams: (string | number)[] = [params.guildId];

  if (params.timeRangeMs !== undefined) {
    const cutoffTime = Date.now() - params.timeRangeMs;
    query += ` AND created_at > ?`;
    queryParams.push(cutoffTime);
  }

  // Get all embedded knowledge for this guild (with optional time filter)
  const rows = db.prepare<KnowledgeEntry & { tags: string }, (string | number)[]>(query).all(...queryParams);

  const entries = rows.map((row) => ({
    ...row,
    tags: JSON.parse(row.tags) as string[],
  }));

  // Filter by tag if specified
  let filtered = entries;
  if (params.tag) {
    const tagLower = params.tag.toLowerCase();
    filtered = entries.filter((e) => e.tags.some((t) => t.toLowerCase() === tagLower));
  }

  // Score and rank by similarity
  const scored: KnowledgeWithScore[] = [];
  for (const entry of filtered) {
    if (!entry.embedding) continue;

    const storedEmbedding = new Float32Array(entry.embedding.buffer);
    const score = cosineSimilarity(queryEmbedding, storedEmbedding);

    // Only include reasonably relevant results
    if (score > 0.25) {
      scored.push({ ...entry, score });
    }
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * Search knowledge using a pre-computed embedding
 * More efficient when embedding is already available
 * @param params.timeRangeMs - Optional time range in milliseconds. If provided, only returns entries created within this time range from now. Undefined = no time filter (knowledge persists indefinitely by default).
 */
export function searchKnowledgeByEmbedding(params: {
  guildId: string;
  embedding: Float32Array;
  limit?: number;
  threshold?: number;
  timeRangeMs?: number;
}): KnowledgeWithScore[] {
  const db = getDb();
  const limit = params.limit ?? 5;
  const threshold = params.threshold ?? 0.3;

  // Build query with optional time filter
  let query = `
    SELECT * FROM knowledge_base 
    WHERE guild_id = ? AND embedding IS NOT NULL
  `;
  const queryParams: (string | number)[] = [params.guildId];

  if (params.timeRangeMs !== undefined) {
    const cutoffTime = Date.now() - params.timeRangeMs;
    query += ` AND created_at > ?`;
    queryParams.push(cutoffTime);
  }

  // Get all embedded knowledge for this guild (with optional time filter)
  const rows = db.prepare<KnowledgeEntry & { tags: string }, (string | number)[]>(query).all(...queryParams);

  const entries = rows.map((row) => ({
    ...row,
    tags: JSON.parse(row.tags) as string[],
  }));

  // Score and rank by similarity
  const scored: KnowledgeWithScore[] = [];
  for (const entry of entries) {
    if (!entry.embedding) continue;

    const storedEmbedding = new Float32Array(entry.embedding.buffer);
    const score = cosineSimilarity(params.embedding, storedEmbedding);

    if (score >= threshold) {
      scored.push({ ...entry, score });
    }
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * Fallback text search when embeddings aren't available
 */
function textSearchKnowledge(params: {
  guildId: string;
  query: string;
  limit?: number;
  tag?: string;
}): KnowledgeWithScore[] {
  const db = getDb();
  const limit = params.limit ?? 10;
  const queryLower = params.query.toLowerCase();

  const rows = db
    .prepare<KnowledgeEntry & { tags: string }, [string]>(
      `
    SELECT * FROM knowledge_base 
    WHERE guild_id = ?
    ORDER BY updated_at DESC
  `,
    )
    .all(params.guildId);

  let entries = rows.map((row) => ({
    ...row,
    tags: JSON.parse(row.tags) as string[],
  }));

  // Filter by tag if specified
  if (params.tag) {
    const tagLower = params.tag.toLowerCase();
    entries = entries.filter((e) => e.tags.some((t) => t.toLowerCase() === tagLower));
  }

  // Simple text matching with score based on occurrence
  const scored: KnowledgeWithScore[] = [];
  for (const entry of entries) {
    const contentLower = entry.content.toLowerCase();
    if (contentLower.includes(queryLower)) {
      // Score based on how much of the content matches
      const score = queryLower.length / contentLower.length;
      scored.push({ ...entry, score: Math.min(score * 2, 1) });
    }
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * Update a knowledge entry
 */
export async function updateKnowledge(id: number, updates: { content?: string; tags?: string[] }): Promise<boolean> {
  const db = getDb();
  const now = Date.now();

  const existing = getKnowledge(id);
  if (!existing) return false;

  const newContent = updates.content ?? existing.content;
  const newTags = updates.tags ?? existing.tags;

  // Regenerate embedding if content changed
  let embedding: Buffer | null = existing.embedding;
  if (updates.content && isEmbedderReady()) {
    try {
      const emb = await embed(newContent);
      embedding = Buffer.from(emb.buffer);
    } catch (error) {
      console.error('Failed to regenerate embedding:', error);
    }
  }

  const result = db
    .prepare(
      `
    UPDATE knowledge_base 
    SET content = ?, tags = ?, embedding = ?, updated_at = ?
    WHERE id = ?
  `,
    )
    .run(newContent, JSON.stringify(newTags), embedding, now, id);

  return result.changes > 0;
}

/**
 * Delete a knowledge entry
 */
export function deleteKnowledge(id: number, guildId: string): boolean {
  const db = getDb();
  const result = db
    .prepare(
      `
    DELETE FROM knowledge_base WHERE id = ? AND guild_id = ?
  `,
    )
    .run(id, guildId);

  return result.changes > 0;
}

/**
 * Get knowledge count for a guild
 */
export function getKnowledgeCount(guildId: string): number {
  const db = getDb();
  const result = db
    .prepare<{ count: number }, [string]>(
      `
    SELECT COUNT(*) as count FROM knowledge_base WHERE guild_id = ?
  `,
    )
    .get(guildId);

  return result?.count ?? 0;
}

/**
 * Get all unique tags used in a guild's knowledge base
 */
export function getKnowledgeTags(guildId: string): string[] {
  const db = getDb();
  const rows = db
    .prepare<{ tags: string }, [string]>(
      `
    SELECT DISTINCT tags FROM knowledge_base WHERE guild_id = ?
  `,
    )
    .all(guildId);

  const tagSet = new Set<string>();
  for (const row of rows) {
    for (const tag of JSON.parse(row.tags) as string[]) {
      tagSet.add(tag.toLowerCase());
    }
  }

  return Array.from(tagSet).sort();
}

/**
 * Get unembedded knowledge entries (for background processing)
 */
export function getUnembeddedKnowledge(limit = 50): Array<{ id: number; content: string; guild_id: string }> {
  const db = getDb();
  return db
    .prepare<{ id: number; content: string; guild_id: string }, [number]>(
      `
    SELECT id, content, guild_id FROM knowledge_base 
    WHERE embedding IS NULL
    ORDER BY created_at ASC
    LIMIT ?
  `,
    )
    .all(limit);
}

/**
 * Store embedding for a knowledge entry (used by background processor)
 */
export function storeKnowledgeEmbedding(id: number, embedding: Float32Array): boolean {
  const db = getDb();
  const now = Date.now();

  const result = db
    .prepare(
      `
    UPDATE knowledge_base SET embedding = ?, updated_at = ? WHERE id = ?
  `,
    )
    .run(Buffer.from(embedding.buffer), now, id);

  return result.changes > 0;
}
