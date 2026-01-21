/**
 * Imagine Command Plugin
 *
 * Midjourney-style /imagine command for image generation with interactive buttons.
 *
 * Flow:
 * 1. User runs /imagine prompt:... [aspect:...] [resolution:...] [style:...]
 * 2. Bot defers response, generates image
 * 3. Bot sends image + buttons (Regenerate, Vary, Upscale)
 *
 * Button behaviors:
 * - Regenerate: Acknowledges, sends new "🔄 Regenerating..." message, generates, sends result
 * - Vary: Acknowledges, sends "🎨 Creating variation..." → "📝 New prompt: ..." → result
 * - Upscale: Acknowledges, sends new "⬆️ Upscaling..." message, generates at higher res
 *
 * Settings are embedded in the message content (no database needed).
 */

import {
  type AspectRatio,
  createPromptVariation,
  generateImage,
  getHigherResolution,
  type ImageResolution,
  isValidAspectRatio,
  isValidResolution,
} from '@app/helpers/image';
import {
  type ButtonInteraction,
  type CommandHandlerPlugin,
  type CommandInvocation,
  type EventBus,
  type Logger,
  type PluginContext,
  registerCommand,
  unregisterCommand,
} from '@core';
import { COMMAND_DEFINITION } from './command';
import { createImageButtons, parseCustomId } from './components';

/** Stored settings format in message content */
interface ImagineSettings {
  prompt: string;
  aspect: AspectRatio;
  resolution: ImageResolution;
  style?: string;
  model?: string;
}

/**
 * Parse settings from message content
 * Format: "**Prompt:** ...\n**Aspect:** ...\n**Resolution:** ...\n[**Style:** ...]\n[**Model:** ...]"
 */
function parseSettingsFromContent(content: string): ImagineSettings | null {
  const promptMatch = content.match(/\*\*Prompt:\*\* (.+?)(?:\n|$)/);
  const aspectMatch = content.match(/\*\*Aspect:\*\* (\d+:\d+)/);
  const resolutionMatch = content.match(/\*\*Resolution:\*\* (\d+K)/);
  const styleMatch = content.match(/\*\*Style:\*\* (.+?)(?:\n|$)/);
  const modelMatch = content.match(/\*\*Model:\*\* (.+?)(?:\n|$)/);

  if (!promptMatch || !aspectMatch || !resolutionMatch) {
    return null;
  }

  const prompt = promptMatch[1];
  const aspect = aspectMatch[1];
  const resolution = resolutionMatch[1];

  if (!prompt || !aspect || !resolution) {
    return null;
  }

  if (!isValidAspectRatio(aspect) || !isValidResolution(resolution)) {
    return null;
  }

  return {
    prompt: prompt.trim(),
    aspect: aspect as AspectRatio,
    resolution: resolution as ImageResolution,
    style: styleMatch?.[1]?.trim(),
    model: modelMatch?.[1]?.trim(),
  };
}

/**
 * Format settings for message content
 */
function formatSettingsContent(settings: ImagineSettings): string {
  let content = `**Prompt:** ${settings.prompt}\n`;
  content += `**Aspect:** ${settings.aspect}\n`;
  content += `**Resolution:** ${settings.resolution}`;
  if (settings.style) {
    content += `\n**Style:** ${settings.style}`;
  }
  if (settings.model) {
    content += `\n**Model:** ${settings.model}`;
  }
  return content;
}

export class ImagineCommandPlugin implements CommandHandlerPlugin {
  readonly id = 'imagine';
  readonly type = 'command' as const;
  readonly commands = ['imagine'];

  private context?: PluginContext;
  private logger?: Logger;
  private eventBus?: EventBus;

  async load(context: PluginContext): Promise<void> {
    this.context = context;
    this.logger = context.logger;
    this.eventBus = context.eventBus;

    // Register command definition
    registerCommand(COMMAND_DEFINITION, this.id);

    // Wire up event handlers
    context.eventBus.on('command:received', this.handleCommand.bind(this));
    context.eventBus.on('interaction:button', this.handleButton.bind(this));

    context.logger.info('ImagineCommandPlugin loaded');
  }

  async unload(): Promise<void> {
    unregisterCommand('imagine');
    this.context?.logger.info('ImagineCommandPlugin unloaded');
    this.context = undefined;
  }

  /**
   * Handle the /imagine command
   */
  private handleCommand = async (invocation: CommandInvocation): Promise<void> => {
    if (invocation.commandName !== 'imagine') return;

    const prompt = invocation.args.prompt as string;
    const aspect = (invocation.args.aspect as AspectRatio) || '1:1';
    const resolution = (invocation.args.resolution as ImageResolution) || '1K';
    const style = invocation.args.style as string | undefined;
    const model = invocation.args.model as string | undefined;

    const settings: ImagineSettings = { prompt, aspect, resolution, style, model };

    // Defer the response (image generation takes time)
    await invocation.defer();

    // Generate the image and send via followUp
    await this.generateAndSendImage(settings, invocation.user.id, async (response) => {
      await invocation.followUp(response);
    });
  };

  /**
   * Handle button interactions
   */
  private handleButton = async (interaction: ButtonInteraction): Promise<void> => {
    const parsed = parseCustomId(interaction.customId);
    if (!parsed) return;

    const { action, ownerId } = parsed;

    // Check ownership
    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content: '❌ Only the person who requested this image can use this button.',
        ephemeral: true,
      });
      return;
    }

    // Get the message content to extract settings
    const raw = interaction.raw as { message?: { content?: string } } | undefined;
    const messageContent = raw?.message?.content;

    if (!messageContent) {
      await interaction.reply({
        content: '❌ Could not retrieve image settings.',
        ephemeral: true,
      });
      return;
    }

    const settings = parseSettingsFromContent(messageContent);
    if (!settings) {
      await interaction.reply({
        content: '❌ Could not parse image settings from message.',
        ephemeral: true,
      });
      return;
    }

    switch (action) {
      case 'regen':
        await this.handleRegenerate(interaction, settings);
        break;

      case 'vary':
        await this.handleVary(interaction, settings);
        break;

      case 'upscale':
        await this.handleUpscale(interaction, settings);
        break;

      default:
        // Like/dislike removed - do nothing
        await interaction.deferUpdate();
    }
  };

  /**
   * Regenerate: Same prompt, new generation
   */
  private async handleRegenerate(interaction: ButtonInteraction, settings: ImagineSettings): Promise<void> {
    // Acknowledge the button click silently
    await interaction.deferUpdate();

    // Start typing indicator
    this.eventBus?.emit('typing:start', {
      channelId: interaction.channel.id,
      platform: 'discord',
    });

    // Send a visible "working" message to the channel
    this.eventBus?.emit('message:send', {
      channelId: interaction.channel.id,
      platform: 'discord',
      message: {
        content: `🔄 **Regenerating image...**\n> ${settings.prompt.slice(0, 100)}${settings.prompt.length > 100 ? '...' : ''}`,
      },
    });

    // Generate and send new image to channel
    await this.generateAndSendToChannel(settings, interaction.user.id, interaction.channel.id);

    // Stop typing indicator
    this.eventBus?.emit('typing:stop', {
      channelId: interaction.channel.id,
      platform: 'discord',
    });
  }

  /**
   * Vary: AI modifies prompt, shows what changed
   */
  private async handleVary(interaction: ButtonInteraction, settings: ImagineSettings): Promise<void> {
    // Acknowledge the button click silently
    await interaction.deferUpdate();

    // Start typing indicator
    this.eventBus?.emit('typing:start', {
      channelId: interaction.channel.id,
      platform: 'discord',
    });

    // Send a visible "thinking" message
    this.eventBus?.emit('message:send', {
      channelId: interaction.channel.id,
      platform: 'discord',
      message: {
        content: '🎨 **Creating variation...**\nThinking of a creative twist...',
      },
    });

    // Get AI variation of the prompt
    const variedPrompt = await createPromptVariation(settings.prompt);

    this.logger?.info('[Imagine] Created prompt variation', {
      original: settings.prompt,
      varied: variedPrompt,
    });

    // Send the new prompt info
    this.eventBus?.emit('message:send', {
      channelId: interaction.channel.id,
      platform: 'discord',
      message: {
        content: `📝 **New prompt:**\n> ${variedPrompt.slice(0, 200)}${variedPrompt.length > 200 ? '...' : ''}\n\n⏳ Generating image...`,
      },
    });

    // Generate with varied prompt
    const variedSettings: ImagineSettings = {
      ...settings,
      prompt: variedPrompt,
    };

    // Send new image with variation info
    await this.generateAndSendToChannel(
      variedSettings,
      interaction.user.id,
      interaction.channel.id,
      `🎨 **Variation of:** ${settings.prompt}\n\n`,
    );

    // Stop typing indicator
    this.eventBus?.emit('typing:stop', {
      channelId: interaction.channel.id,
      platform: 'discord',
    });
  }

  /**
   * Upscale: Regenerate at higher resolution
   */
  private async handleUpscale(interaction: ButtonInteraction, settings: ImagineSettings): Promise<void> {
    const higherRes = getHigherResolution(settings.resolution);

    if (higherRes === settings.resolution) {
      await interaction.reply({
        content: '⬆️ Already at maximum resolution (4K)!',
        ephemeral: true,
      });
      return;
    }

    // Acknowledge the button click silently
    await interaction.deferUpdate();

    // Start typing indicator
    this.eventBus?.emit('typing:start', {
      channelId: interaction.channel.id,
      platform: 'discord',
    });

    // Send a visible "working" message
    this.eventBus?.emit('message:send', {
      channelId: interaction.channel.id,
      platform: 'discord',
      message: {
        content: `⬆️ **Upscaling to ${higherRes}...**\n> ${settings.prompt.slice(0, 100)}${settings.prompt.length > 100 ? '...' : ''}`,
      },
    });

    const upscaledSettings: ImagineSettings = {
      ...settings,
      resolution: higherRes,
    };

    // Send new upscaled image
    await this.generateAndSendToChannel(
      upscaledSettings,
      interaction.user.id,
      interaction.channel.id,
      `⬆️ **Upscaled to ${higherRes}**\n\n`,
    );

    // Stop typing indicator
    this.eventBus?.emit('typing:stop', {
      channelId: interaction.channel.id,
      platform: 'discord',
    });
  }

  /**
   * Generate image and send to channel via eventBus
   */
  private async generateAndSendToChannel(
    settings: ImagineSettings,
    userId: string,
    channelId: string,
    prefix: string = '',
  ): Promise<void> {
    try {
      const result = await generateImage({
        prompt: settings.prompt,
        aspectRatio: settings.aspect,
        resolution: settings.resolution,
        style: settings.style,
        model: settings.model,
      });

      if (!result.success || !result.imageBuffer) {
        // Send error message with context so AI can pick up if user replies
        const errorContent = [
          `❌ **Image generation failed**`,
          ``,
          `**Original request:** ${settings.prompt}`,
          settings.style ? `**Style:** ${settings.style}` : null,
          `**Aspect:** ${settings.aspect} | **Resolution:** ${settings.resolution}`,
          ``,
          `**Reason:** ${result.error ?? 'Unknown error'}`,
          ``,
          `_Reply to this message to try again with clarifications._`,
        ]
          .filter(Boolean)
          .join('\n');

        this.eventBus?.emit('message:send', {
          channelId,
          platform: 'discord',
          message: {
            content: errorContent,
          },
        });
        return;
      }

      // Format content with settings
      const content = prefix + formatSettingsContent(settings);
      const canUpscale = settings.resolution !== '4K';

      // Send image with buttons via eventBus
      this.eventBus?.emit('message:send', {
        channelId,
        platform: 'discord',
        message: {
          content,
          attachments: [
            {
              data: result.imageBuffer,
              filename: 'generated-image.png',
            },
          ],
          components: [createImageButtons(userId, canUpscale)],
        },
      });

      this.logger?.info('[Imagine] Image sent to channel', {
        userId,
        channelId,
        prompt: settings.prompt,
        aspect: settings.aspect,
        resolution: settings.resolution,
      });
    } catch (error) {
      this.logger?.error('[Imagine] Generation error', {
        error: error instanceof Error ? error.message : String(error),
      });

      this.eventBus?.emit('message:send', {
        channelId,
        platform: 'discord',
        message: {
          content: `❌ An error occurred: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
      });
    }
  }

  /**
   * Generate image and send via callback (for command responses)
   */
  private async generateAndSendImage(
    settings: ImagineSettings,
    userId: string,
    send: (response: import('@core').CommandResponse) => Promise<void>,
  ): Promise<void> {
    try {
      const result = await generateImage({
        prompt: settings.prompt,
        aspectRatio: settings.aspect,
        resolution: settings.resolution,
        style: settings.style,
        model: settings.model,
      });

      if (!result.success || !result.imageBuffer) {
        // Send error message with context so AI can pick up if user replies
        const errorContent = [
          `❌ **Image generation failed**`,
          ``,
          `**Original request:** ${settings.prompt}`,
          settings.style ? `**Style:** ${settings.style}` : null,
          `**Aspect:** ${settings.aspect} | **Resolution:** ${settings.resolution}`,
          ``,
          `**Reason:** ${result.error ?? 'Unknown error'}`,
          ``,
          `_Reply to this message to try again with clarifications._`,
        ]
          .filter(Boolean)
          .join('\n');

        await send({ content: errorContent });
        return;
      }

      const content = formatSettingsContent(settings);
      const canUpscale = settings.resolution !== '4K';

      await send({
        content,
        attachments: [
          {
            filename: 'generated-image.png',
            data: result.imageBuffer,
          },
        ],
        components: [createImageButtons(userId, canUpscale)],
      });

      this.logger?.info('[Imagine] Image sent', {
        userId,
        prompt: settings.prompt,
        aspect: settings.aspect,
        resolution: settings.resolution,
      });
    } catch (error) {
      this.logger?.error('[Imagine] Generation error', {
        error: error instanceof Error ? error.message : String(error),
      });

      await send({
        content: `❌ An error occurred: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  }
}

export default ImagineCommandPlugin;
