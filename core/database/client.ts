/**
 * Database Client - SQLite with bun:sqlite
 *
 * Provides a singleton database connection with vector search support.
 */

import { Database } from 'bun:sqlite';
import fs from 'fs';
import path from 'path';

let db: Database | null = null;

export interface DatabaseConfig {
  /** Path to the SQLite database file */
  path?: string;
  /** Enable verbose logging */
  verbose?: boolean;
}

/**
 * Initialize the database connection eagerly
 * Call this at startup to ensure DB is ready
 */
export function initDatabase(config: DatabaseConfig = {}): Database {
  return getDb(config);
}

/**
 * Get or create the database connection
 */
export function getDb(config: DatabaseConfig = {}): Database {
  if (db) return db;

  const dbPath = config.path ?? path.join(process.cwd(), 'data', 'bot.db');

  // Ensure data directory exists
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  db = new Database(dbPath);

  // Enable WAL mode for better concurrent access
  db.exec('PRAGMA journal_mode = WAL');

  // Wait up to 5000ms for a lock instead of failing immediately
  db.exec('PRAGMA busy_timeout = 5000');

  // Synchronous NORMAL is faster and safe enough for WAL mode
  db.exec('PRAGMA synchronous = NORMAL');

  // Enable foreign keys
  db.exec('PRAGMA foreign_keys = ON');

  return db;
}

/** Alias for getDb */
export const getDatabase = getDb;

/**
 * Close the database connection
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * Check if database is connected
 */
export function isDatabaseConnected(): boolean {
  return db !== null;
}

/**
 * Run a function within a transaction
 */
export function transaction<T>(fn: () => T): T {
  const database = getDb();
  return database.transaction(fn)();
}

/**
 * Cosine similarity between two vectors (pure JS fallback)
 */
export function cosineSimilarity(a: Float32Array | number[], b: Float32Array | number[]): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have the same length');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const aVal = a[i]!;
    const bVal = b[i]!;
    dotProduct += aVal * bVal;
    normA += aVal * aVal;
    normB += bVal * bVal;
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  return magnitude === 0 ? 0 : dotProduct / magnitude;
}

/**
 * Serialize a float array to a buffer for storage
 */
export function serializeVector(vector: number[] | Float32Array): Buffer {
  const float32 = vector instanceof Float32Array ? vector : new Float32Array(vector);
  return Buffer.from(float32.buffer);
}

/**
 * Deserialize a buffer back to a Float32Array
 */
export function deserializeVector(buffer: Buffer): Float32Array {
  return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.length / 4);
}
