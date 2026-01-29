/**
 * Local Embedder - Free embeddings using @xenova/transformers
 *
 * Uses Xenova/all-MiniLM-L6-v2 for fast, free similarity matching.
 * - 384 dimensions (vs 3072 for OpenAI)
 * - ~22MB model size
 * - Runs locally, no API costs
 */

import { pipeline } from '@xenova/transformers';

// Singleton pattern - model loaded once
let embedderPipeline: any = null;
let isReady = false;

/**
 * Initialize the local embedder at startup
 * Loads the Xenova/all-MiniLM-L6-v2 model (384 dimensions, ~22MB)
 */
export async function initLocalEmbedder(logger?: {
  info: (msg: string) => void;
  error: (msg: string, meta?: any) => void;
}): Promise<void> {
  if (embedderPipeline) return; // Already initialized

  try {
    embedderPipeline = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    isReady = true;
    if (logger) {
      logger.info('[LocalEmbedder] Ready: Xenova/all-MiniLM-L6-v2 (384 dimensions)');
    }
  } catch (error) {
    if (logger) {
      logger.error('[LocalEmbedder] Failed to initialize:', { error });
    }
    throw error;
  }
}

/**
 * Check if the local embedder is ready to use
 */
export function isLocalEmbedderReady(): boolean {
  return isReady;
}

/**
 * Generate a local embedding for text
 * @param text Text to embed
 * @returns 384-dimensional embedding as Float32Array
 */
export async function localEmbed(text: string): Promise<Float32Array> {
  if (!embedderPipeline) {
    throw new Error('Local embedder not initialized. Call initLocalEmbedder() first.');
  }

  try {
    // Generate embedding with mean pooling and normalization
    const output = await embedderPipeline(text, {
      pooling: 'mean',
      normalize: true,
    });

    // Convert to Float32Array
    return new Float32Array(output.data);
  } catch (error) {
    console.error('[LocalEmbedder] Embedding failed:', error);
    throw error;
  }
}

/**
 * Generate embeddings for multiple texts in batch
 * @param texts Array of texts to embed
 * @returns Array of embeddings
 */
export async function localEmbedBatch(texts: string[]): Promise<Float32Array[]> {
  return Promise.all(texts.map((t) => localEmbed(t)));
}

/**
 * Calculate cosine similarity between two embeddings
 * @param a First embedding
 * @param b Second embedding
 * @returns Similarity score between 0 and 1
 */
export function localCosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
