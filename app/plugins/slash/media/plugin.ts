/**
 * Media Slash Command Plugin
 * Located in app/plugins/slash/media/ per project conventions
 * Uses app/helpers/media/ for the actual download logic
 */

import {
  type CommandHandlerPlugin,
  type CommandInvocation,
  type PluginContext,
  registerCommand,
  unregisterCommand,
} from '@core';
import { type MediaResult, MediaService } from '../../../helpers/media/media.service';

export class MediaCommandPlugin implements CommandHandlerPlugin {
  readonly id = 'embedmedia';
  readonly type = 'command' as const;
  readonly commands = ['embedmedia'];

  private context?: PluginContext;
  private service?: MediaService;

  async load(context: PluginContext): Promise<void> {
    this.context = context;
    this.service = new MediaService();

    // Register slash command
    registerCommand(
      {
        name: 'embedmedia',
        description: 'Download and display content from social media URLs (Reddit, etc.)',
        options: [
          {
            name: 'url',
            description: 'The URL to process (Instagram, TikTok, Reddit)',
            type: 'string',
            required: true,
          },
        ],
      },
      this.id,
    );

    // Wire up command handler
    context.eventBus.on('command:received', this.handleCommand.bind(this));

    context.logger.info('MediaCommandPlugin loaded');
  }

  async unload(): Promise<void> {
    unregisterCommand('embedmedia');
    this.context?.logger.info('MediaCommandPlugin unloaded');
  }

  private handleCommand = async (invocation: CommandInvocation): Promise<void> => {
    if (invocation.commandName !== 'embedmedia') return;

    const url = invocation.args.url as string;
    const platform = this.service?.getPlatform(url);

    if (!platform) {
      try {
        await invocation.reply({
          content: '❌ Unsupported platform. Currently supporting: Instagram, TikTok, Reddit.',
          ephemeral: true,
        });
      } catch {
        // Interaction expired, ignore
      }
      return;
    }

    try {
      await invocation.defer();
    } catch (error) {
      // Interaction already expired or responded, ignore
      this.context?.logger.debug('Failed to defer interaction', { error });
      return;
    }

    let result: MediaResult | null = null;

    try {
      result = (await this.service?.processMedia(url)) ?? null;

      if (!result || !result.success || result.items.length === 0) {
        await invocation.followUp({
          content: `❌ ${result?.error || 'Could not extract content from that URL.'}`,
        });
        return;
      }

      // Check if content is NSFW and channel allows it
      if (result.isNsfw && !invocation.channel.nsfw) {
        await invocation.followUp({
          content: '🔞 This content is age-restricted (NSFW) and can only be posted in age-restricted channels.',
        });
        return;
      }

      // Build embed for nice presentation
      const metadata = result.metadata;
      const embed: import('@core').BotEmbed = {
        title: metadata?.title || 'Media Content',
        color: this.getPlatformColor(result.platform),
        url,
      };

      if (metadata?.author) {
        embed.author = {
          name: metadata.author,
          url: metadata.authorUrl,
        };
      }

      if (metadata?.footer) {
        embed.footer = { text: metadata.footer };
      }

      // Create platform-agnostic attachments (matches CommandResponse.attachments)
      const attachments: Array<{ filename: string; data: Buffer | string }> = [];

      for (const item of result.items) {
        if (item.buffer) {
          // File is in memory as buffer
          attachments.push({
            data: item.buffer,
            filename: item.filename || `media_${attachments.length + 1}.${item.type === 'video' ? 'mp4' : 'jpg'}`,
          });
        } else if (item.localPath) {
          // File is on disk - read it into buffer for platform-agnostic handling
          const fileBuffer = await Bun.file(item.localPath).arrayBuffer();
          attachments.push({
            data: Buffer.from(fileBuffer),
            filename: item.filename || `media_${attachments.length + 1}.${item.type === 'video' ? 'mp4' : 'jpg'}`,
          });
        }
      }

      // Send response with embed and attachments
      await invocation.followUp({
        embeds: [embed],
        attachments,
      });

      this.context?.logger.info('Media download successful', {
        platform,
        url,
        itemCount: result.items.length,
      });
    } catch (error) {
      this.context?.logger.error('Media command failed', { error, url });
      // Only try to send error if we haven't already responded
      try {
        await invocation.followUp({
          content: `❌ ${error instanceof Error ? error.message : 'Failed to process media URL.'}`,
        });
      } catch {
        // Interaction already completed or expired, ignore
      }
    } finally {
      // Cleanup temp files
      if (result?.tempFiles && result.tempFiles.length > 0) {
        await this.service?.cleanup(result.tempFiles);
      }
    }
  };

  /**
   * Get platform-specific embed color
   */
  private getPlatformColor(platform: string): number {
    const colors: Record<string, number> = {
      instagram: 0xe1306c, // Instagram pink/magenta
      tiktok: 0x010101, // TikTok black (with accent)
      reddit: 0xff4500, // Reddit orange
      twitter: 0x1da1f2, // Twitter blue
    };
    return colors[platform] ?? 0x5865f2; // Default Discord blurple
  }
}

export default MediaCommandPlugin;
