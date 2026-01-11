/**
 * Embedder - Local embedding model using transformers.js
 *
 * Uses the BGE-small-en model for generating text embeddings.
 * Same model as SARA v2 for consistency.
 */

import { type FeatureExtractionPipeline, pipeline } from '@xenova/transformers';

const MODEL_NAME = 'Xenova/bge-small-en-v1.5';
const EMBEDDING_DIM = 384;

let embedder: FeatureExtractionPipeline | null = null;
let isLoading = false;
let loadPromise: Promise<FeatureExtractionPipeline> | null = null;

/**
 * Get or initialize the embedding pipeline
 */
async function getEmbedder(): Promise<FeatureExtractionPipeline> {
  if (embedder) return embedder;

  if (loadPromise) return loadPromise;

  isLoading = true;
  loadPromise = pipeline('feature-extraction', MODEL_NAME, {
    quantized: true, // Use quantized model for faster inference
  });

  embedder = await loadPromise;
  isLoading = false;

  return embedder;
}

/**
 * Warm up the embedding model (load into memory)
 * @deprecated Use initEmbedder() instead
 */
export async function warmupEmbedder(): Promise<void> {
  return initEmbedder();
}

/**
 * Initialize the embedding model eagerly
 * Call this at startup to ensure embedder is ready
 */
export async function initEmbedder(): Promise<void> {
  console.log(`Loading embedding model: ${MODEL_NAME}...`);
  const start = Date.now();
  await getEmbedder();
  console.log(`Embedding model loaded in ${Date.now() - start}ms`);
}

/**
 * Check if the embedder is ready
 */
export function isEmbedderReady(): boolean {
  return embedder !== null;
}

/**
 * Check if the embedder is currently loading
 */
export function isEmbedderLoading(): boolean {
  return isLoading;
}

/**
 * Generate embedding for a single text
 */
export async function embed(text: string): Promise<Float32Array> {
  const model = await getEmbedder();

  // BGE models work best with a prefix for retrieval
  const prefixedText = `Represent this sentence for retrieval: ${text}`;

  const output = await model(prefixedText, {
    pooling: 'mean',
    normalize: true,
  });

  // Extract the embedding from the tensor
  // The data property is a typed array that we need to convert
  const data = output.data;
  if (data instanceof Float32Array) {
    return data;
  }
  // Handle other array types
  return new Float32Array(Array.from(data as ArrayLike<number>));
}

/**
 * Generate embeddings for multiple texts (batched)
 */
export async function embedBatch(texts: string[]): Promise<Float32Array[]> {
  const model = await getEmbedder();

  const prefixedTexts = texts.map((t) => `Represent this sentence for retrieval: ${t}`);

  const outputs = await model(prefixedTexts, {
    pooling: 'mean',
    normalize: true,
  });

  // Split batched output into individual embeddings
  const embeddings: Float32Array[] = [];
  const rawData = outputs.data;
  const data = rawData instanceof Float32Array ? rawData : new Float32Array(Array.from(rawData as ArrayLike<number>));

  for (let i = 0; i < texts.length; i++) {
    const start = i * EMBEDDING_DIM;
    const end = start + EMBEDDING_DIM;
    embeddings.push(new Float32Array(data.slice(start, end)));
  }

  return embeddings;
}

/**
 * Get the embedding dimension
 */
export function getEmbeddingDimension(): number {
  return EMBEDDING_DIM;
}
