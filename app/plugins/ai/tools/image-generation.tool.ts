/**
 * Image Generation Tool
 *
 * Generates images using OpenRouter's image generation models.
 * Uses the shared image generation helper.
 */

import { generateImage } from '@app/helpers/image';
import type { AspectRatio, ImageResolution } from '@app/helpers/image/types';
import { sendToWebhook } from '@app/helpers/webhook';
import type { Tool, ToolExecutionContext, ToolMetadata, ToolResult, ToolSchema } from '@core';
import { getBotConfig } from '@core';
import {
  getDefaultWebhook,
  getUserApiKey,
  getUserByPlatformId,
  getUserWebhooks,
  getWebhookByCategory,
  type WebhookConfig,
} from '@core/database';
import { z } from 'zod';

interface ImageGenerationArgs {
  prompt: string;
  style?: string;
  reference_image_url?: string;
  model?: string;
  aspect_ratio?: string;
  resolution?: string;
  webhookSend?: boolean;
  webhookCategory?: string;
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

  /**
   * Build tool schema dynamically from config
   */
  get schema(): ToolSchema {
    const config = getBotConfig();
    const imageModels = config?.ai?.imageModels ?? [];

    if (imageModels.length === 0) {
      return this.getFallbackSchema();
    }

    const modelDescriptions = imageModels
      .map((m, i) => {
        const isDefault = i === 0 ? ' (default)' : '';
        return `- **${m.model}**${isDefault}: ${m.description}`;
      })
      .join('\n');

    const defaultModel = imageModels[0]?.model ?? 'unknown';
    const nsfwModels = imageModels.filter((m) => m.description.toLowerCase().includes('nsfw'));

    return {
      type: 'function',
      name: 'image_generation',
      description: `Generate an image from a text prompt.

🚨 CRITICAL: Model Selection is REQUIRED

**For NSFW/Spicy Content, YOU MUST:**
- Use model ending with "seedream-4.5"${nsfwModels.map((m) => ` or "${m.model}"`).join('')} (explicit NSFW support)
- Look for these keywords: spicy, nude, naked, explicit, adult, sexy, erotic, nsfw
- If you see ANY of these → ALWAYS use seedream-4.5, NEVER use default model

**For Safe/General Content:**
- Use default model (default: ${defaultModel}) for general images
- For high quality: "gpt-5-image-mini" or "flux.2-pro" for detailed/complex prompts

**Model Selection Examples:**
User: "spicy Akeno"
→ Use seedream-4.5 (detected: "spicy")

User: "nude woman"
→ Use seedream-4.5 (detected: "nude")

User: "Akeno in school"
→ Use flux.2-klein-4b (safe content)

User: "erotic art"
→ Use seedream-4.5 (detected: "erotic")

⚠️ Fallback is only for when you FAIL to detect NSFW. Do NOT rely on it.

🚨 CRITICAL INSTRUCTIONS - ALWAYS FOLLOW:

You MUST ALWAYS provide \`aspect_ratio\` and \`resolution\` parameters. NEVER skip them, even if the user doesn't explicitly request specific values.

**HOW TO INTERPRET USER REQUESTS:**
Aspect Ratio - look for these patterns:
- "16:9", "21:9", "4:3", etc. (direct ratios)
- "widescreen", "ultrawide", "landscape" → "16:9" or "21:9"
- "portrait", "vertical", "phone" → "2:3" or "9:16"
- "square" → "1:1"

Resolution - look for these patterns:
- "4K", "2K" (direct)
- "high res", "ultra", "HD", "1080p" → "4K"
- "medium" → "2K"
- no mention → "1K"

**USAGE EXAMPLES:**
User: "make it 21:9 and 4K"
→ aspect_ratio="21:9", resolution="4K" (NOT in prompt!)

User: "create a portrait image"
→ aspect_ratio="2:3", resolution="1K"

User: "draw a cat"
→ aspect_ratio="1:1", resolution="1K" (defaults)

User: "ultrawide high res landscape"
→ aspect_ratio="21:9", resolution="4K"

**Aspect Ratio & Resolution Options:**
- \`aspect_ratio\`: "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"
- \`resolution\`: "1K", "2K", "4K"

**Available Models:**
${modelDescriptions}`,
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
            enum: imageModels.map((m) => m.model),
            description: `Image model to use. Defaults to ${defaultModel}. Select a model based on desired style and content type.`,
          },
          aspect_ratio: {
            type: 'string',
            description:
              'Aspect ratio of the generated image (e.g., "1:1", "16:9", "21:9"). Use "1:1" if user doesn\'t specify',
            enum: ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'],
          },
          resolution: {
            type: 'string',
            description:
              'Resolution quality of the generated image (e.g., "1K", "2K", "4K"). Use "1K" if user doesn\'t specify',
            enum: ['1K', '2K', '4K'],
          },
          webhookSend: {
            type: 'boolean',
            description:
              'If true, also send the image to a configured webhook. The image is always sent to the channel first.',
          },
          webhookCategory: {
            type: 'string',
            description:
              'Category to match against user webhook config (e.g., "nsfw", "art", "car"). If not specified, uses the user\'s default webhook.',
          },
        },
        required: ['prompt'],
        additionalProperties: false,
      },
      strict: true,
    };
  }

  /**
   * Fallback schema when no image models are configured
   */
  private getFallbackSchema(): ToolSchema {
    return {
      type: 'function',
      name: 'image_generation',
      description:
        'Generate an image from a text prompt. **Note: No image models configured in config - add imageModels to ai config to enable this tool.**',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'Detailed description of the image to generate.',
          },
        },
        required: ['prompt'],
        additionalProperties: false,
      },
      strict: true,
    };
  }

  /**
   * Validate that OpenRouter API key is available and image models are configured
   */
  validate(): boolean {
    try {
      const config = getBotConfig();
      const hasApiKey = !!config?.tokens?.openrouter;
      const hasImageModels = !!config?.ai?.imageModels && config.ai.imageModels.length > 0;
      return hasApiKey && hasImageModels;
    } catch {
      return false;
    }
  }

  // Zod schema for input validation
  private readonly argsSchema = z.object({
    prompt: z.string().min(1).max(2000),
    style: z.string().max(500).optional(),
    reference_image_url: z.string().url().optional(),
    model: z.string().optional(),
    aspect_ratio: z.enum(['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']).optional(),
    resolution: z.enum(['1K', '2K', '4K']).optional(),
    webhookSend: z.boolean().optional(),
    webhookCategory: z.string().max(100).optional(),
  });

  async execute(args: unknown, context: ToolExecutionContext): Promise<ToolResult> {
    // Validate input
    const parseResult = this.argsSchema.safeParse(args);
    if (!parseResult.success) {
      return {
        success: false,
        error: {
          type: 'validation_error',
          message: `Invalid parameters: ${parseResult.error.message}`,
        },
      };
    }

    const config = getBotConfig();
    const botApiKey = config?.tokens?.openrouter;
    const imageModels = config?.ai?.imageModels ?? [];

    // Check for user's API key
    const dbUser = getUserByPlatformId('discord', context.user.id);
    const userId = dbUser?.id;
    const userApiKey = userId ? getUserApiKey(userId) : null;
    const apiKey = userApiKey || botApiKey;

    if (!apiKey) {
      return {
        success: false,
        error: {
          type: 'configuration_error',
          message: 'OpenRouter API key is not configured',
        },
      };
    }

    if (imageModels.length === 0) {
      return {
        success: false,
        error: {
          type: 'configuration_error',
          message: 'No image models configured in config.ai.imageModels',
        },
      };
    }

    try {
      const params = parseResult.data;
      const userChosenModel = params.model;
      const firstModel = imageModels[0];
      if (!firstModel) {
        return {
          success: false,
          error: {
            type: 'configuration_error',
            message: 'No image models configured in config',
          },
        };
      }
      const defaultModel = firstModel.model;

      // Validate model selection
      if (userChosenModel) {
        const isValid = imageModels.some((m) => m.model === userChosenModel);
        if (!isValid) {
          const modelList = imageModels.map((m) => `- \`${m.model}\`: ${m.description}`).join('\n');
          return {
            success: false,
            error: {
              type: 'validation_error',
              message: `Invalid model: "${userChosenModel}". You must use a valid model ID.\n\nAvailable models:\n${modelList}\n\nPlease retry the tool with a valid model ID.`,
            },
          };
        }
      }

      const requestedModel = userChosenModel ?? defaultModel;

      context.logger.info('[ImageGenerationTool] Generating image', {
        prompt: params.prompt,
        style: params.style,
        hasReferenceImage: !!params.reference_image_url,
        model: requestedModel,
        usingUserKey: !!userApiKey,
      });

      let result = await generateImage({
        prompt: params.prompt,
        style: params.style,
        referenceImageUrl: params.reference_image_url,
        model: requestedModel,
        aspectRatio: params.aspect_ratio as AspectRatio,
        resolution: params.resolution as ImageResolution,
        apiKey,
      });

      // Automatic fallback: if primary model refused and user didn't explicitly request it
      // Try to find an alternative model (e.g., one with NSFW support)
      if (!result.success && userChosenModel === undefined && this.isModerationRefusal(result.error)) {
        const fallbackModel = imageModels.find(
          (m) => m.model !== defaultModel && m.description.toLowerCase().includes('nsfw'),
        );

        if (fallbackModel) {
          context.logger.info('[ImageGenerationTool] Model refused due to moderation, falling back to', {
            fallbackModel: fallbackModel.model,
          });

          result = await generateImage({
            prompt: params.prompt,
            style: params.style,
            referenceImageUrl: params.reference_image_url,
            model: fallbackModel.model,
            aspectRatio: params.aspect_ratio as AspectRatio,
            resolution: params.resolution as ImageResolution,
            apiKey,
          });

          if (result.success) {
            return await this.handleSuccess(result, params, context, true, fallbackModel.model);
          }
        }
      }

      if (!result.success || !result.imageBuffer) {
        throw new Error(result.error ?? 'Image generation failed');
      }

      return await this.handleSuccess(result, params, context, false, requestedModel);
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
    modelUsed: string,
  ): Promise<ToolResult> {
    const { webhookSend, webhookCategory } = params;

    // Send image to channel and get the attachment URL back
    const sendResult = await new Promise<{
      success: boolean;
      messageId?: string;
      attachments?: Array<{ url: string; name: string | null }>;
      error?: string;
    }>((resolve) => {
      context.eventBus.emit('message:send-with-result', {
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
        resolve,
      });

      // Timeout after 30 seconds
      setTimeout(() => resolve({ success: false, error: 'Timeout waiting for message send' }), 30000);
    });

    if (!sendResult.success) {
      context.logger.error('[ImageGenerationTool] Failed to send image to channel', {
        error: sendResult.error,
      });
      return {
        success: false,
        error: {
          type: 'send_failed',
          message: `Failed to send image to channel: ${sendResult.error}`,
          retryable: true,
        },
      };
    }

    const imageUrl = sendResult.attachments?.[0]?.url;

    context.logger.info('[ImageGenerationTool] Image sent to channel', {
      bufferSize: result.imageBuffer.length,
      model: result.model,
      aspectRatio: result.aspectRatio,
      resolution: result.resolution,
      fallbackUsed,
      imageUrl,
    });

    // ALSO send to webhook if requested
    let webhookSent = false;
    let webhookName: string | undefined;

    if (webhookSend && imageUrl) {
      // Get user's internal ID for webhook lookup
      const dbUser = getUserByPlatformId('discord', context.user.id);
      const userId = dbUser?.id;

      if (userId) {
        const _webhooks = getUserWebhooks(userId);
        let targetWebhook: WebhookConfig | null = null;

        if (webhookCategory) {
          targetWebhook = getWebhookByCategory(userId, webhookCategory);
        }
        if (!targetWebhook) {
          targetWebhook = getDefaultWebhook(userId);
        }

        if (targetWebhook) {
          context.logger.info('[ImageGenerationTool] Sending image URL to webhook', {
            webhookName: targetWebhook.name,
            category: webhookCategory,
            imageUrl,
          });

          const webhookResult = await sendToWebhook(targetWebhook.url, {
            metadata: {
              url: imageUrl,
              label: webhookCategory || 'default',
              prompt: params.prompt,
              timestamp: new Date().toISOString(),
            },
          });

          if (webhookResult.success) {
            webhookSent = true;
            webhookName = targetWebhook.name;
            context.logger.info('[ImageGenerationTool] Image URL sent to webhook successfully', {
              webhookName: targetWebhook.name,
            });
          } else {
            context.logger.warn('[ImageGenerationTool] Webhook send failed', {
              webhookName: targetWebhook.name,
              error: webhookResult.error,
            });
          }
        } else {
          context.logger.warn('[ImageGenerationTool] Webhook send requested but no matching webhook configured', {
            userId,
            webhookCategory,
          });
        }
      }
    }

    const fallbackInfo = fallbackUsed ? ' (model refused, fell back to alternative due to content moderation)' : '';
    const webhookInfo = webhookSent ? ` Also sent to webhook "${webhookName}".` : '';

    return {
      success: true,
      data: {
        prompt: params.prompt,
        model: result.model,
        aspectRatio: result.aspectRatio,
        resolution: result.resolution,
        sent_to_channel: true,
        sent_to_webhook: webhookSent,
        webhookName: webhookName,
        fallback_used: fallbackUsed,
      },
      message: `✅ I've generated and sent the image using **${modelUsed}**${fallbackInfo} based on your prompt: "${params.prompt}"${webhookInfo}`,
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
