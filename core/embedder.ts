/**
 * Embedder - OpenAI embeddings via OpenRouter API
 *
 * Uses text-embedding-3-large for high-quality multilingual embeddings.
 */

import { getBotConfig } from './config';
import { fetcher } from './helpers/fetcher';

const DEFAULT_MODEL = 'openai/text-embedding-3-large';
const EMBEDDING_DIM = 3072;

// Track in-flight requests to prevent duplicate API calls
const inFlightRequests = new Map<string, Promise<Float32Array>>();

/**
 * Get the OpenRouter API key
 */
function getApiKey(): string | null {
  const config = getBotConfig();
  return config?.tokens?.openrouter ?? null;
}

/**
 * Initialize the embedder (no-op for API-based embeddings)
 * Kept for backwards compatibility
 */
export async function initEmbedder(logger?: {
  warn: (msg: string) => void;
  info: (msg: string) => void;
}): Promise<void> {
  const apiKey = getApiKey();
  if (!apiKey) {
    if (logger) {
      logger.warn('OpenRouter API key not configured - embeddings will not work');
    }
    return;
  }
  if (logger) {
    logger.info(`Embedder ready: ${DEFAULT_MODEL} (${EMBEDDING_DIM} dimensions)`);
  }
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
 * Generate embedding for a single text (with deduplication)
 */
export async function embed(text: string): Promise<Float32Array> {
  // Normalize cache key
  const cacheKey = text.trim();

  // Check for in-flight request
  const existing = inFlightRequests.get(cacheKey);
  if (existing) {
    return existing;
  }

  // Create promise for this request
  const promise = embedInternal(text);
  inFlightRequests.set(cacheKey, promise);

  try {
    return await promise;
  } finally {
    // Clean up after completion (success or failure)
    inFlightRequests.delete(cacheKey);
  }
}

/**
 * Internal function that performs the actual embedding API call
 */
async function embedInternal(text: string): Promise<Float32Array> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('OpenRouter API key not configured');
  }

  const config = getBotConfig();
  const baseUrl = config.ai?.openRouterBaseUrl ?? 'https://openrouter.ai/api/v1';

  const response = await fetcher(`${baseUrl}/embeddings`, {
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
    timeout: 30000,
    retries: 2,
    retryDelay: 1000,
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

  const config = getBotConfig();
  const baseUrl = config.ai?.openRouterBaseUrl ?? 'https://openrouter.ai/api/v1';

  const response = await fetcher(`${baseUrl}/embeddings`, {
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
    timeout: 30000,
    retries: 2,
    retryDelay: 1000,
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
