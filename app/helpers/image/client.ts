/**
 * Image Generation Client
 *
 * OpenRouter API client for image generation using multimodal models.
 */

import { getBotConfig } from '@core';
import { convertToPng, getImageDimensions } from './convert';
import {
  ASPECT_RATIO_DIMENSIONS,
  type AspectRatio,
  aspectRatioToOpenAISize,
  type ImageGenerationRequest,
  type ImageGenerationResult,
  type ImageResolution,
  resolutionToOpenAIQuality,
} from './types';

/** Check if debug mode is enabled via CLI flag */
const isDebugMode = () => process.argv.includes('--debug') || process.argv.includes('-d');

/**
 * Generate an image using OpenRouter's multimodal API
 */
export async function generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
  const config = getBotConfig();
  // Use provided API key (user's) or fall back to bot's key from config
  const apiKey = request.apiKey || config?.tokens?.openrouter;

  if (!apiKey) {
    return {
      success: false,
      error: 'OpenRouter API key is not configured',
      model: '',
      prompt: request.prompt,
      aspectRatio: request.aspectRatio ?? '1:1',
      resolution: request.resolution ?? '1K',
    };
  }

  const imageModels = config?.ai?.imageModels;

  if (!imageModels || imageModels.length === 0) {
    return {
      success: false,
      error: 'No image models configured in config.ai.imageModels',
      model: '',
      prompt: request.prompt,
      aspectRatio: request.aspectRatio ?? '1:1',
      resolution: request.resolution ?? '1K',
    };
  }

  // Use model from request, or fall back to config default (first in imageModels array)
  const firstModel = imageModels[0]?.model;
  if (!firstModel) {
    return {
      success: false,
      error: 'No image models configured in config.ai.imageModels',
      model: '',
      prompt: request.prompt,
      aspectRatio: request.aspectRatio ?? '1:1',
      resolution: request.resolution ?? '1K',
    };
  }
  const model = request.model ?? firstModel;
  const userAspectRatio = request.aspectRatio;
  const userResolution = request.resolution;
  let aspectRatio: AspectRatio = request.aspectRatio ?? '1:1';
  let resolution: ImageResolution = request.resolution ?? '1K';

  try {
    // Build the prompt with optional style enhancement
    let enhancedPrompt = request.prompt;
    if (request.style) {
      enhancedPrompt = `${request.style} style: ${request.prompt}`;
    }

    // For OpenAI models, add explicit size/orientation hints to the prompt
    // since the API size parameter may not be respected through OpenRouter
    if (isOpenAIImageModel(model) && aspectRatio !== '1:1') {
      const orientationHint = getOrientationHint(aspectRatio);
      enhancedPrompt = `[${orientationHint}] ${enhancedPrompt}`;
    }

    // Build message content
    let messageContent: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;

    if (request.referenceImageUrl) {
      // Try to download and convert reference image to base64
      // If it fails, fall back to text-only prompt
      try {
        const cleanUrl = request.referenceImageUrl.replace(/&amp;/g, '&');
        const imageResponse = await fetch(cleanUrl, { signal: AbortSignal.timeout(15000) });

        if (!imageResponse.ok) {
          console.warn(`[ImageClient] Reference image fetch failed: ${imageResponse.status}, proceeding without it`);
          messageContent = enhancedPrompt;
        } else {
          const referenceArrayBuffer = await imageResponse.arrayBuffer();
          const referenceBuffer = Buffer.from(referenceArrayBuffer);

          // Validate it's actually an image
          const dims = await getImageDimensions(referenceBuffer);
          if (!dims) {
            console.warn('[ImageClient] Reference URL is not a valid image, proceeding without it');
            messageContent = enhancedPrompt;
          } else {
            // If the user didn't specify sizing, preserve the reference image aspect ratio/size
            if (!userAspectRatio) {
              aspectRatio = getNearestAspectRatio(dims.width, dims.height);
            }
            if (!userResolution) {
              resolution = getResolutionForDimensions(dims.width, dims.height);
            }

            const pngBuffer = await convertToPng(referenceBuffer);
            const base64 = pngBuffer.toString('base64');
            const imageDataUrl = `data:image/png;base64,${base64}`;

            // Multi-modal input: text + reference image
            messageContent = [
              { type: 'text', text: enhancedPrompt },
              { type: 'image_url', image_url: { url: imageDataUrl } },
            ];
          }
        }
      } catch (refError) {
        console.warn('[ImageClient] Failed to process reference image, proceeding without it:', refError);
        messageContent = enhancedPrompt;
      }
    } else {
      messageContent = enhancedPrompt;
    }

    // Call OpenRouter API with image generation config
    // Build request body with model-specific parameters
    const requestBody = buildImageRequestBody(model, messageContent, aspectRatio, resolution);

    // Debug: log the request body to verify parameters
    if (isDebugMode()) {
      // Use console for CLI debug output (not production logging)
      console.debug('[ImageClient] Request body:', JSON.stringify(requestBody, null, 2));
    }

    const baseUrl = config.ai?.openRouterBaseUrl ?? 'https://openrouter.ai/api/v1';
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/karbowiak/SARA',
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(90000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter API error: ${response.status} - ${errorText}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{
        error?: {
          message?: string;
          code?: number;
          metadata?: {
            raw?: { code?: string; message?: string } | string;
            provider_name?: string;
          };
        };
        message?: {
          content?: string | Array<{ type?: string; image_url?: { url?: string }; url?: string }>;
          images?: Array<{ image_url?: { url?: string }; url?: string }>;
        };
      }>;
    };

    // Check for choice-level errors (e.g., OpenAI moderation rejections)
    const choiceError = data.choices?.[0]?.error;
    if (choiceError) {
      // Extract the most descriptive error message
      let errorMessage = choiceError.message ?? 'Image generation was rejected';
      const rawMeta = choiceError.metadata?.raw;
      if (typeof rawMeta === 'object' && rawMeta?.message) {
        errorMessage = rawMeta.message;
      } else if (typeof rawMeta === 'string') {
        try {
          const parsed = JSON.parse(rawMeta);
          if (parsed.message) errorMessage = parsed.message;
          if (parsed.details?.['Moderation Reasons']) {
            errorMessage += ` (Reasons: ${parsed.details['Moderation Reasons'].join(', ')})`;
          }
        } catch {
          // rawMeta is just a string, might already be descriptive
        }
      }
      console.error('[ImageClient] Provider error:', errorMessage);
      throw new Error(errorMessage);
    }

    const message = data.choices?.[0]?.message;
    let imageUrl: string | undefined;

    // Try to extract image from different possible response formats
    // Format 1: OpenRouter's images field
    const imagesField = message?.images;
    if (imagesField && Array.isArray(imagesField) && imagesField.length > 0) {
      imageUrl = imagesField[0]?.image_url?.url || imagesField[0]?.url;
    }

    // Format 2: Content array with image_url type
    if (!imageUrl && Array.isArray(message?.content)) {
      for (const item of message.content) {
        if (item?.type === 'image_url' && item?.image_url?.url) {
          imageUrl = item.image_url.url;
          break;
        }
      }
    }

    // Format 3: Direct content as string (might be a URL or base64)
    if (!imageUrl && typeof message?.content === 'string') {
      const content = message.content.trim();
      if (content.startsWith('data:image/') || content.startsWith('http')) {
        imageUrl = content;
      }
    }

    if (!imageUrl || typeof imageUrl !== 'string') {
      // Check if the model returned a text response (safety refusal or clarification request)
      const textContent = typeof message?.content === 'string' ? message.content : null;
      if (textContent && textContent.length > 0) {
        // Model returned text instead of image - likely a safety refusal
        console.warn('[ImageClient] Model returned text instead of image:', textContent);
        throw new Error(`Model response: ${textContent}`);
      }
      // Log what we actually received for debugging
      console.error('[ImageClient] No image in response. Raw data:', JSON.stringify(data, null, 2).slice(0, 1000));
      throw new Error('No image returned from API');
    }

    // Convert to buffer
    let imageBuffer: Buffer;

    if (imageUrl.startsWith('data:image/')) {
      // Base64 data URL
      const base64Data = imageUrl.split(',')[1];
      if (!base64Data) {
        throw new Error('Invalid base64 data URL format');
      }
      imageBuffer = Buffer.from(base64Data, 'base64');
    } else {
      // HTTP URL - download it
      const imgResponse = await fetch(imageUrl, {
        signal: AbortSignal.timeout(30000),
      });
      if (!imgResponse.ok) {
        throw new Error(`Failed to download generated image: ${imgResponse.status}`);
      }
      imageBuffer = Buffer.from(await imgResponse.arrayBuffer());
    }

    // Debug: Check actual image dimensions
    if (isDebugMode()) {
      const dims = await getImageDimensions(imageBuffer);
      if (dims) {
        // Use console for CLI debug output (not production logging)
        console.debug(`[ImageClient] Actual image dimensions: ${dims.width}x${dims.height}`);
      }
    }

    return {
      success: true,
      imageBuffer,
      model,
      prompt: enhancedPrompt,
      aspectRatio,
      resolution,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      model: model ?? 'unknown',
      prompt: request.prompt,
      aspectRatio: aspectRatio ?? '1:1',
      resolution: resolution ?? '1K',
    };
  }
}

/**
 * Use AI to create a variation of a prompt
 * Returns a slightly modified version of the prompt
 */
export async function createPromptVariation(originalPrompt: string): Promise<string> {
  const config = getBotConfig();
  const apiKey = config?.tokens?.openrouter;

  if (!apiKey) {
    // Fallback: just return original with minor tweak
    return `${originalPrompt}, with interesting variations`;
  }

  const model = config?.ai?.defaultModel ?? 'anthropic/claude-sonnet-4-20250514';
  const baseUrl = config?.ai?.openRouterBaseUrl ?? 'https://openrouter.ai/api/v1';

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/karbowiak/SARA',
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content:
              'You are a creative assistant that modifies image prompts. Given an image prompt, create a slightly different variation that keeps the core concept but adds interesting creative twists. Only respond with the new prompt, nothing else. Keep it concise.',
          },
          {
            role: 'user',
            content: `Create a variation of this image prompt:\n\n"${originalPrompt}"`,
          },
        ],
        max_tokens: 200,
        temperature: 0.8,
      }),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const variation = data.choices?.[0]?.message?.content?.trim();
    return variation || `${originalPrompt}, with creative variations`;
  } catch {
    // Fallback on error
    return `${originalPrompt}, reimagined with new details`;
  }
}

function getNearestAspectRatio(width: number, height: number): AspectRatio {
  const target = width / height;
  let best: AspectRatio = '1:1';
  let bestDiff = Number.POSITIVE_INFINITY;

  for (const ratio of Object.keys(ASPECT_RATIO_DIMENSIONS) as AspectRatio[]) {
    const dims = ASPECT_RATIO_DIMENSIONS[ratio];
    const value = dims.width / dims.height;
    const diff = Math.abs(value - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = ratio;
    }
  }

  return best;
}

function getResolutionForDimensions(width: number, height: number): ImageResolution {
  const maxDim = Math.max(width, height);
  if (maxDim <= 1024) return '1K';
  if (maxDim <= 2048) return '2K';
  return '4K';
}

/**
 * Check if a model is an OpenAI image model (gpt-5-image, etc.)
 * These models have limitations: they don't respect size/aspect ratio params through OpenRouter
 */
function isOpenAIImageModel(model: string): boolean {
  return model.startsWith('openai/') && model.includes('image');
}

/**
 * Get a natural language orientation hint for the prompt
 * This helps OpenAI models understand the desired image shape
 */
function getOrientationHint(aspectRatio: AspectRatio): string {
  // Portrait ratios
  if (['2:3', '3:4', '4:5', '9:16'].includes(aspectRatio)) {
    return 'vertical portrait orientation, taller than wide';
  }
  // Landscape ratios
  if (['3:2', '4:3', '5:4', '16:9', '21:9'].includes(aspectRatio)) {
    return 'horizontal landscape orientation, wider than tall';
  }
  // Square
  return 'square format';
}

/**
 * Build the request body with model-specific parameters
 *
 * OpenRouter supports provider passthrough via extra_body or direct params.
 * We try both approaches for OpenAI models.
 */
function buildImageRequestBody(
  model: string,
  messageContent: string | Array<{ type: string; text?: string; image_url?: { url: string } }>,
  aspectRatio: AspectRatio,
  resolution: ImageResolution,
): Record<string, unknown> {
  const baseBody = {
    model,
    messages: [{ role: 'user', content: messageContent }],
    modalities: ['image'],
  };

  if (isOpenAIImageModel(model)) {
    // OpenAI models: use native OpenAI parameters
    // Pass both at root level and via extra_body for maximum compatibility
    const openAISize = aspectRatioToOpenAISize(aspectRatio);
    const openAIQuality = resolutionToOpenAIQuality(resolution);

    return {
      ...baseBody,
      // Root level (in case OpenRouter passes these through)
      size: openAISize,
      quality: openAIQuality,
      // extra_body for provider passthrough (OpenRouter feature)
      extra_body: {
        size: openAISize,
        quality: openAIQuality,
      },
    };
  }

  // Gemini and other models: use image_config object (officially supported)
  return {
    ...baseBody,
    image_config: {
      aspect_ratio: aspectRatio,
      image_size: resolution,
    },
  };
}
