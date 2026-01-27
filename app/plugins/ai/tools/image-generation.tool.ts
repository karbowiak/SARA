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
  model?: 'openai/gpt-5-image-mini' | 'bytedance-seed/seedream-4.5';
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
    description: `Generate an image from a text prompt, optionally using a reference image. Can modify existing images or create new ones. The generated image will be sent directly to the chat. Images are always square (1:1 aspect ratio).

**Model Selection:**
- Default: openai/gpt-5-image-mini (high quality, best for safe/general content)
- Use bytedance-seed/seedream-4.5 for NSFW, adult, or suggestive content
- Automatic fallback: If OpenAI refuses due to moderation, will automatically retry with seedream and inform you of the fallback`,
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
        model: {
          type: 'string',
          enum: ['openai/gpt-5-image-mini', 'bytedance-seed/seedream-4.5'],
          description:
            'Image model to use. Defaults to openai/gpt-5-image-mini. Use bytedance-seed/seedream-4.5 for NSFW/adult content. OpenAI has stricter moderation.',
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
      const userChosenModel = params.model;
      const requestedModel = userChosenModel ?? 'openai/gpt-5-image-mini';

      context.logger.info('[ImageGenerationTool] Generating image', {
        prompt: params.prompt,
        style: params.style,
        hasReferenceImage: !!params.reference_image_url,
        model: requestedModel,
      });

      let result = await generateImage({
        prompt: params.prompt,
        style: params.style,
        referenceImageUrl: params.reference_image_url,
        model: requestedModel,
      });

      // Automatic fallback: if OpenAI refused and user didn't explicitly request it
      if (
        !result.success &&
        requestedModel === 'openai/gpt-5-image-mini' &&
        !userChosenModel &&
        this.isModerationRefusal(result.error)
      ) {
        context.logger.info('[ImageGenerationTool] OpenAI refused due to moderation, falling back to seedream');

        result = await generateImage({
          prompt: params.prompt,
          style: params.style,
          referenceImageUrl: params.reference_image_url,
          model: 'bytedance-seed/seedream-4.5',
        });

        if (result.success) {
          return await this.handleSuccess(result, params, context, true);
        }
      }

      if (!result.success || !result.imageBuffer) {
        throw new Error(result.error ?? 'Image generation failed');
      }

      return await this.handleSuccess(result, params, context, false);
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

  /**
   * Handle successful image generation
   */
  private async handleSuccess(
    result: any,
    params: ImageGenerationArgs,
    context: ToolExecutionContext,
    fallbackUsed: boolean,
  ): Promise<ToolResult> {
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
      fallbackUsed,
    });

    const fallbackInfo = fallbackUsed ? ' (OpenAI refused, fell back to seedream due to content moderation)' : '';

    return {
      success: true,
      data: {
        prompt: params.prompt,
        model: result.model,
        aspectRatio: result.aspectRatio,
        resolution: result.resolution,
        sent_to_channel: true,
        fallback_used: fallbackUsed,
      },
      message: `✅ I've generated and sent the image using **${result.model}**${fallbackInfo} based on your prompt: "${params.prompt}"`,
    };
  }

  /**
   * Check if an error indicates a moderation refusal from OpenAI
   */
  private isModerationRefusal(error?: string): boolean {
    if (!error) return false;
    const lowerError = error.toLowerCase();
    return (
      lowerError.includes('moderation') ||
      lowerError.includes('safety') ||
      lowerError.includes('content policy') ||
      lowerError.includes('harmful') ||
      lowerError.includes('refused') ||
      lowerError.includes('flagged')
    );
  }
}
