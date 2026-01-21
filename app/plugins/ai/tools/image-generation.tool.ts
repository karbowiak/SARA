/**
 * Image Generation Tool
 *
 * Generates images using OpenRouter's image generation models.
 * Uses the shared image generation helper.
 */

import { generateImage } from '@app/helpers/image';
import type { Tool, ToolExecutionContext, ToolMetadata, ToolResult, ToolSchema } from '@core';
import { getBotConfig } from '@core';

interface ImageGenerationArgs {
  prompt: string;
  style?: string;
  reference_image_url?: string;
}

/**
 * Image generation tool using OpenRouter
 */
export class ImageGenerationTool implements Tool {
  readonly metadata: ToolMetadata = {
    name: 'image_generation',
    description: 'Generate images using AI image models',
    version: '1.0.0',
    author: 'system',
    keywords: [
      'image',
      'picture',
      'photo',
      'draw',
      'create',
      'generate',
      'make',
      'show me',
      'paint',
      'illustrate',
      'render',
      'design',
      'artwork',
      'art',
      'visual',
      'graphic',
      'sketch',
    ],
    category: 'creative',
    priority: 5,
  };

  readonly schema: ToolSchema = {
    type: 'function',
    name: 'image_generation',
    description:
      'Generate an image from a text prompt, optionally using a reference image. Can modify existing images or create new ones. The generated image will be sent directly to the chat. Images are always square (1:1 aspect ratio).',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description:
            'Detailed description of the image to generate or how to modify the reference image. Be specific and descriptive.',
        },
        style: {
          type: 'string',
          description: 'Optional style hint (e.g., "photorealistic", "anime", "oil painting")',
        },
        reference_image_url: {
          type: 'string',
          description:
            'Optional URL of an image to use as reference or to modify. Use this when the user provides an image attachment.',
        },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
    strict: true,
  };

  /**
   * Validate that OpenRouter API key is available
   */
  validate(): boolean {
    const config = getBotConfig();
    return !!config?.tokens?.openrouter;
  }

  async execute(args: unknown, context: ToolExecutionContext): Promise<ToolResult> {
    const config = getBotConfig();
    const apiKey = config?.tokens?.openrouter;

    if (!apiKey) {
      return {
        success: false,
        error: {
          type: 'configuration_error',
          message: 'OpenRouter API key is not configured',
        },
      };
    }

    try {
      const params = args as ImageGenerationArgs;

      context.logger.info('[ImageGenerationTool] Generating image', {
        prompt: params.prompt,
        style: params.style,
        hasReferenceImage: !!params.reference_image_url,
      });

      // Use shared image generation client (always 1:1 for gpt-5-image-mini)
      const result = await generateImage({
        prompt: params.prompt,
        style: params.style,
        referenceImageUrl: params.reference_image_url,
      });

      if (!result.success || !result.imageBuffer) {
        throw new Error(result.error ?? 'Image generation failed');
      }

      // Send image via event bus
      context.eventBus.emit('message:send', {
        channelId: context.channel.id,
        platform: context.message.platform,
        message: {
          attachments: [
            {
              data: result.imageBuffer,
              filename: 'generated-image.png',
            },
          ],
          replyToId: context.message.id,
        },
      });

      context.logger.info('[ImageGenerationTool] Image sent to channel', {
        bufferSize: result.imageBuffer.length,
        model: result.model,
        aspectRatio: result.aspectRatio,
        resolution: result.resolution,
      });

      return {
        success: true,
        data: {
          prompt: params.prompt,
          model: result.model,
          aspectRatio: result.aspectRatio,
          resolution: result.resolution,
          sent_to_channel: true,
        },
        message: `✅ I've generated and sent the image based on your prompt: "${params.prompt}"`,
      };
    } catch (error) {
      context.logger.error('[ImageGenerationTool] Generation failed', {
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        success: false,
        error: {
          type: 'execution_error',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }
}
