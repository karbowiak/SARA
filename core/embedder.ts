/**
 * Embedder - OpenAI embeddings via OpenRouter API
 *
 * Uses text-embedding-3-large for high-quality multilingual embeddings.
 */

import { getBotConfig } from './config';

const DEFAULT_MODEL = 'openai/text-embedding-3-large';
const EMBEDDING_DIM = 3072;

// Cache config to avoid repeated lookups
let cachedApiKey: string | null = null;

/**
 * Get the OpenRouter API key
 */
function getApiKey(): string | null {
  if (cachedApiKey) return cachedApiKey;
  const config = getBotConfig();
  cachedApiKey = config?.tokens?.openrouter ?? null;
  return cachedApiKey;
}

/**
 * Initialize the embedder (no-op for API-based embeddings)
 * Kept for backwards compatibility
 */
export async function initEmbedder(): Promise<void> {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.warn('OpenRouter API key not configured - embeddings will not work');
    return;
  }
  console.log(`Embedder ready: ${DEFAULT_MODEL} (${EMBEDDING_DIM} dimensions)`);
}

/**
 * Warm up the embedding model (legacy alias)
 * @deprecated Use initEmbedder() instead
 */
export async function warmupEmbedder(): Promise<void> {
  return initEmbedder();
}

/**
 * Check if the embedder is ready
 */
export function isEmbedderReady(): boolean {
  return getApiKey() !== null;
}

/**
 * Check if the embedder is currently loading (always false for API)
 */
export function isEmbedderLoading(): boolean {
  return false;
}

/**
 * Generate embedding for a single text
 */
export async function embed(text: string): Promise<Float32Array> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('OpenRouter API key not configured');
  }

  const response = await fetch('https://openrouter.ai/api/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/karbowiak/bot',
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      input: text,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Embedding API error: ${response.status} - ${errorText}`);
  }

  const data = (await response.json()) as {
    data?: Array<{ embedding?: number[] }>;
  };

  const embedding = data.data?.[0]?.embedding;
  if (!embedding || !Array.isArray(embedding)) {
    throw new Error('Invalid embedding response from API');
  }

  return new Float32Array(embedding);
}

/**
 * Generate embeddings for multiple texts (batched)
 */
export async function embedBatch(texts: string[]): Promise<Float32Array[]> {
  if (texts.length === 0) return [];

  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('OpenRouter API key not configured');
  }

  const response = await fetch('https://openrouter.ai/api/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/karbowiak/bot',
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      input: texts,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Embedding API error: ${response.status} - ${errorText}`);
  }

  const data = (await response.json()) as {
    data?: Array<{ embedding?: number[]; index?: number }>;
  };

  if (!data.data || !Array.isArray(data.data)) {
    throw new Error('Invalid batch embedding response from API');
  }

  // Sort by index to ensure correct order
  const sorted = data.data.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

  return sorted.map((item) => {
    if (!item.embedding || !Array.isArray(item.embedding)) {
      throw new Error('Invalid embedding in batch response');
    }
    return new Float32Array(item.embedding);
  });
}

/**
 * Get the embedding dimension
 */
export function getEmbeddingDimension(): number {
  return EMBEDDING_DIM;
}
