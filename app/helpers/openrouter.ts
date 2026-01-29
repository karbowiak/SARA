/**
 * OpenRouter Model Validation Helper
 *
 * Provides utilities for validating model IDs against the OpenRouter API
 * and filtering models by capability (e.g., image generation).
 */

import { getBotConfig } from '@core';

/**
 * OpenRouter model information
 */
export interface OpenRouterModel {
  id: string;
  name: string;
  description?: string;
  context_length?: number;
  pricing?: { prompt: string; completion: string };
  architecture?: {
    modality?: string;
    input_modalities?: string[];
    output_modalities?: string[];
  };
}

/** API response structure */
interface OpenRouterModelsResponse {
  data: OpenRouterModel[];
}

/** Cache entry with timestamp */
interface ModelCache {
  models: OpenRouterModel[];
  timestamp: number;
}

/** Cache duration: 1 hour in milliseconds */
const CACHE_TTL_MS = 60 * 60 * 1000;

/** Module-level cache */
let modelCache: ModelCache | null = null;

/**
 * Fetch all available models from OpenRouter API
 *
 * Results are cached in memory for 1 hour to avoid excessive API calls.
 *
 * @param apiKey - Optional API key (uses bot config if not provided)
 * @returns Array of available models, or empty array on error
 */
export async function getOpenRouterModels(apiKey?: string): Promise<OpenRouterModel[]> {
  // Check cache validity
  if (modelCache && Date.now() - modelCache.timestamp < CACHE_TTL_MS) {
    return modelCache.models;
  }

  // Resolve API key
  const resolvedKey = apiKey ?? getBotConfig()?.tokens?.openrouter;

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (resolvedKey) {
      headers.Authorization = `Bearer ${resolvedKey}`;
    }

    const response = await fetch('https://openrouter.ai/api/v1/models', {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      console.error(`OpenRouter API error: ${response.status} ${response.statusText}`);
      return modelCache?.models ?? [];
    }

    const data = (await response.json()) as OpenRouterModelsResponse;

    // Update cache
    modelCache = {
      models: data.data ?? [],
      timestamp: Date.now(),
    };

    return modelCache.models;
  } catch (error) {
    console.error('Failed to fetch OpenRouter models:', error);
    // Return stale cache if available, otherwise empty array
    return modelCache?.models ?? [];
  }
}

/**
 * Validate whether a model ID exists in OpenRouter
 *
 * @param modelId - The model ID to validate (e.g., 'anthropic/claude-sonnet-4-20250514')
 * @param apiKey - Optional API key (uses bot config if not provided)
 * @returns True if the model exists, false otherwise
 */
export async function validateModel(modelId: string, apiKey?: string): Promise<boolean> {
  const models = await getOpenRouterModels(apiKey);
  return models.some((model) => model.id === modelId);
}

/**
 * Get all models capable of generating images
 *
 * Filters models based on their architecture.output_modalities including 'image'.
 *
 * @param apiKey - Optional API key (uses bot config if not provided)
 * @returns Array of image-capable models, or empty array on error
 */
export async function getImageModels(apiKey?: string): Promise<OpenRouterModel[]> {
  const models = await getOpenRouterModels(apiKey);
  return models.filter((model) => model.architecture?.output_modalities?.includes('image'));
}

/**
 * Clear the model cache
 *
 * Useful for testing or forcing a refresh.
 */
export function clearModelCache(): void {
  modelCache = null;
}
