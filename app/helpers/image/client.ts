/**
 * Image Generation Client
 *
 * OpenRouter API client for image generation using multimodal models.
 */

import { getBotConfig } from '@core';
import type { AspectRatio, ImageGenerationRequest, ImageGenerationResult, ImageResolution } from './types';

/** Default model for image generation */
const DEFAULT_IMAGE_MODEL = 'google/gemini-2.0-flash-exp:free';

/**
 * Generate an image using OpenRouter's multimodal API
 */
export async function generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
  const config = getBotConfig();
  const apiKey = config?.tokens?.openrouter;

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

  const model = config?.ai?.imageModel ?? DEFAULT_IMAGE_MODEL;
  const aspectRatio: AspectRatio = request.aspectRatio ?? '1:1';
  const resolution: ImageResolution = request.resolution ?? '1K';

  try {
    // Build the prompt with optional style enhancement
    let enhancedPrompt = request.prompt;
    if (request.style) {
      enhancedPrompt = `${request.style} style: ${request.prompt}`;
    }

    // Build message content
    let messageContent: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;

    if (request.referenceImageUrl) {
      // Download and convert reference image to base64
      const cleanUrl = request.referenceImageUrl.replace(/&amp;/g, '&');
      const imageResponse = await fetch(cleanUrl);

      if (!imageResponse.ok) {
        throw new Error(`Failed to download reference image: ${imageResponse.status}`);
      }

      const imageBuffer = await imageResponse.arrayBuffer();
      const base64 = Buffer.from(imageBuffer).toString('base64');
      const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';
      const imageDataUrl = `data:${contentType};base64,${base64}`;

      // Multi-modal input: text + reference image
      messageContent = [
        { type: 'text', text: enhancedPrompt },
        { type: 'image_url', image_url: { url: imageDataUrl } },
      ];
    } else {
      messageContent = enhancedPrompt;
    }

    // Call OpenRouter API with image generation config
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/karbowiak/SARA',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: messageContent }],
        modalities: ['image', 'text'],
        image_config: {
          aspect_ratio: aspectRatio,
          image_size: resolution,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter API error: ${response.status} - ${errorText}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string | Array<{ type?: string; image_url?: { url?: string }; url?: string }>;
          images?: Array<{ image_url?: { url?: string }; url?: string }>;
        };
      }>;
    };

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
      const imgResponse = await fetch(imageUrl);
      if (!imgResponse.ok) {
        throw new Error(`Failed to download generated image: ${imgResponse.status}`);
      }
      imageBuffer = Buffer.from(await imgResponse.arrayBuffer());
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
      model,
      prompt: request.prompt,
      aspectRatio,
      resolution,
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

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
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
