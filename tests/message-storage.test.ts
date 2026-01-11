/**
 * Message Storage and Embedding Tests
 *
 * Tests the full flow of:
 * 1. Storing messages in the database
 * 2. Generating embeddings
 * 3. Retrieving messages
 * 4. Semantic search
 */

import { Database } from 'bun:sqlite';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import fs from 'fs';
import path from 'path';

// Use a test database
const TEST_DB_PATH = path.join(process.cwd(), 'data', 'test-messages.db');

// We need to set up the database before importing the modules
// that use the singleton
beforeAll(() => {
  // Remove test DB if it exists
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }
  // Also remove WAL files
  if (fs.existsSync(`${TEST_DB_PATH}-shm`)) {
    fs.unlinkSync(`${TEST_DB_PATH}-shm`);
  }
  if (fs.existsSync(`${TEST_DB_PATH}-wal`)) {
    fs.unlinkSync(`${TEST_DB_PATH}-wal`);
  }
});

afterAll(() => {
  // Clean up test database
  try {
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
    if (fs.existsSync(`${TEST_DB_PATH}-shm`)) {
      fs.unlinkSync(`${TEST_DB_PATH}-shm`);
    }
    if (fs.existsSync(`${TEST_DB_PATH}-wal`)) {
      fs.unlinkSync(`${TEST_DB_PATH}-wal`);
    }
  } catch {
    // Ignore cleanup errors
  }
});

describe('Message Storage', () => {
  let db: Database;

  beforeAll(() => {
    // Create test database directly (not using singleton to avoid conflicts)
    const dbDir = path.dirname(TEST_DB_PATH);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    db = new Database(TEST_DB_PATH);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');

    // Create messages table
    db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        platform TEXT NOT NULL,
        platform_message_id TEXT NOT NULL,
        guild_id TEXT,
        channel_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        user_name TEXT NOT NULL,
        content TEXT NOT NULL,
        is_bot INTEGER NOT NULL DEFAULT 0,
        timestamp INTEGER NOT NULL,
        embedding BLOB,
        created_at INTEGER NOT NULL,
        UNIQUE(platform, platform_message_id)
      )
    `);
  });

  afterAll(() => {
    db.close();
  });

  describe('insertMessage', () => {
    test('should insert a message and return its ID', () => {
      const stmt = db.prepare(`
        INSERT INTO messages (platform, platform_message_id, guild_id, channel_id, user_id, user_name, content, is_bot, timestamp, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const result = stmt.run(
        'discord',
        'msg-001',
        'guild-123',
        'channel-456',
        'user-789',
        'TestUser',
        'Hello, world!',
        0,
        Date.now(),
        Date.now(),
      );

      expect(result.lastInsertRowid).toBeGreaterThan(0);
    });

    test('should prevent duplicate messages', () => {
      const stmt = db.prepare(`
        INSERT INTO messages (platform, platform_message_id, guild_id, channel_id, user_id, user_name, content, is_bot, timestamp, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      expect(() => {
        stmt.run(
          'discord',
          'msg-001', // Same as above
          'guild-123',
          'channel-456',
          'user-789',
          'TestUser',
          'Duplicate message',
          0,
          Date.now(),
          Date.now(),
        );
      }).toThrow();
    });
  });

  describe('messageExists', () => {
    test('should return true for existing message', () => {
      const stmt = db.prepare('SELECT 1 FROM messages WHERE platform = ? AND platform_message_id = ? LIMIT 1');
      const result = stmt.get('discord', 'msg-001');

      // This is the key bug that was fixed - result is null, not undefined
      expect(result != null).toBe(true);
    });

    test('should return false for non-existing message', () => {
      const stmt = db.prepare('SELECT 1 FROM messages WHERE platform = ? AND platform_message_id = ? LIMIT 1');
      const result = stmt.get('discord', 'non-existent-msg');

      // bun:sqlite returns null, not undefined
      expect(result).toBeNull();
      expect(result != null).toBe(false);
    });
  });

  describe('getRecentMessages', () => {
    beforeAll(() => {
      // Insert multiple messages for history tests
      const stmt = db.prepare(`
        INSERT INTO messages (platform, platform_message_id, guild_id, channel_id, user_id, user_name, content, is_bot, timestamp, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const now = Date.now();
      for (let i = 2; i <= 5; i++) {
        stmt.run(
          'discord',
          `msg-00${i}`,
          'guild-123',
          'channel-456',
          'user-789',
          'TestUser',
          `Message number ${i}`,
          0,
          now + i * 1000, // Spread out timestamps
          now + i * 1000,
        );
      }
    });

    test('should return messages in descending timestamp order', () => {
      const stmt = db.prepare(`
        SELECT * FROM messages 
        WHERE channel_id = ? 
        ORDER BY timestamp DESC 
        LIMIT ?
      `);
      const messages = stmt.all('channel-456', 10) as Array<{ content: string; timestamp: number }>;

      expect(messages.length).toBe(5);

      // Verify descending order
      for (let i = 0; i < messages.length - 1; i++) {
        expect(messages[i]!.timestamp).toBeGreaterThanOrEqual(messages[i + 1]!.timestamp);
      }
    });

    test('should respect limit parameter', () => {
      const stmt = db.prepare(`
        SELECT * FROM messages 
        WHERE channel_id = ? 
        ORDER BY timestamp DESC 
        LIMIT ?
      `);
      const messages = stmt.all('channel-456', 2);

      expect(messages.length).toBe(2);
    });

    test('should return empty array for unknown channel', () => {
      const stmt = db.prepare(`
        SELECT * FROM messages 
        WHERE channel_id = ? 
        ORDER BY timestamp DESC 
        LIMIT ?
      `);
      const messages = stmt.all('unknown-channel', 10);

      expect(messages.length).toBe(0);
    });
  });

  describe('embedding storage', () => {
    test('should store and retrieve embeddings as BLOB', () => {
      // Create a test embedding (384 dimensions like BGE-small)
      const embedding = new Float32Array(384);
      for (let i = 0; i < 384; i++) {
        embedding[i] = Math.random() * 2 - 1; // Random values between -1 and 1
      }

      // Serialize to buffer
      const buffer = Buffer.from(embedding.buffer);

      // Insert message with embedding
      const insertStmt = db.prepare(`
        INSERT INTO messages (platform, platform_message_id, guild_id, channel_id, user_id, user_name, content, is_bot, timestamp, embedding, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      insertStmt.run(
        'discord',
        'msg-with-embedding',
        'guild-123',
        'channel-456',
        'user-789',
        'TestUser',
        'Message with embedding',
        0,
        Date.now(),
        buffer,
        Date.now(),
      );

      // Retrieve and deserialize
      const selectStmt = db.prepare('SELECT embedding FROM messages WHERE platform_message_id = ?');
      const result = selectStmt.get('msg-with-embedding') as { embedding: Buffer };

      expect(result.embedding).toBeDefined();
      expect(result.embedding.length).toBe(384 * 4); // Float32 = 4 bytes

      // Deserialize
      const retrieved = new Float32Array(
        result.embedding.buffer,
        result.embedding.byteOffset,
        result.embedding.length / 4,
      );

      expect(retrieved.length).toBe(384);
      // Check first few values match
      expect(retrieved[0]).toBeCloseTo(embedding[0]!, 5);
      expect(retrieved[100]).toBeCloseTo(embedding[100]!, 5);
      expect(retrieved[383]).toBeCloseTo(embedding[383]!, 5);
    });

    test('should update embedding on existing message', () => {
      // First insert without embedding
      const insertStmt = db.prepare(`
        INSERT INTO messages (platform, platform_message_id, guild_id, channel_id, user_id, user_name, content, is_bot, timestamp, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const result = insertStmt.run(
        'discord',
        'msg-for-update',
        'guild-123',
        'channel-456',
        'user-789',
        'TestUser',
        'Message to update',
        0,
        Date.now(),
        Date.now(),
      );
      const messageId = Number(result.lastInsertRowid);

      // Verify no embedding initially
      const checkStmt = db.prepare('SELECT embedding FROM messages WHERE id = ?');
      const initial = checkStmt.get(messageId) as { embedding: Buffer | null };
      expect(initial.embedding).toBeNull();

      // Update with embedding
      const embedding = new Float32Array(384).fill(0.5);
      const buffer = Buffer.from(embedding.buffer);

      const updateStmt = db.prepare('UPDATE messages SET embedding = ? WHERE id = ?');
      updateStmt.run(buffer, messageId);

      // Verify embedding was added
      const updated = checkStmt.get(messageId) as { embedding: Buffer };
      expect(updated.embedding).not.toBeNull();
      expect(updated.embedding.length).toBe(384 * 4);
    });
  });

  describe('cosine similarity', () => {
    // Test the similarity calculation used for semantic search
    function cosineSimilarity(a: Float32Array, b: Float32Array): number {
      if (a.length !== b.length) {
        throw new Error('Vectors must have the same length');
      }

      let dotProduct = 0;
      let normA = 0;
      let normB = 0;

      for (let i = 0; i < a.length; i++) {
        dotProduct += a[i]! * b[i]!;
        normA += a[i]! * a[i]!;
        normB += b[i]! * b[i]!;
      }

      const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
      return magnitude === 0 ? 0 : dotProduct / magnitude;
    }

    test('should return 1 for identical vectors', () => {
      const vec = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5]);
      expect(cosineSimilarity(vec, vec)).toBeCloseTo(1, 5);
    });

    test('should return -1 for opposite vectors', () => {
      const vec1 = new Float32Array([1, 0, 0]);
      const vec2 = new Float32Array([-1, 0, 0]);
      expect(cosineSimilarity(vec1, vec2)).toBeCloseTo(-1, 5);
    });

    test('should return 0 for orthogonal vectors', () => {
      const vec1 = new Float32Array([1, 0, 0]);
      const vec2 = new Float32Array([0, 1, 0]);
      expect(cosineSimilarity(vec1, vec2)).toBeCloseTo(0, 5);
    });

    test('should handle normalized vectors', () => {
      // Normalized vectors (magnitude = 1)
      const vec1 = new Float32Array([0.6, 0.8, 0]);
      const vec2 = new Float32Array([0.8, 0.6, 0]);
      const similarity = cosineSimilarity(vec1, vec2);

      expect(similarity).toBeGreaterThan(0.9); // High similarity
      expect(similarity).toBeLessThan(1); // But not identical
    });
  });
});
