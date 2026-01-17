/**
 * Auto Media Plugin - Automatically processes Instagram and TikTok links
 *
 * Watches for Instagram/TikTok URLs in messages and automatically:
 * 1. Detects the URL
 * 2. Suppresses Discord embeds
 * 3. Downloads the media
 * 4. Uploads to the channel
 * 5. Cleans up temp files
 *
 * Scope: 'all' - processes every message
 */

import type { BotMessage, MessageHandlerPlugin, PluginContext } from '@core';
import { type MediaResult, MediaService } from '../../helpers/media/media.service';
import { compressVideo, formatFileSize } from '../../helpers/media/utils/videoCompressor';

export class MediaAutoPlugin implements MessageHandlerPlugin {
  readonly id = 'media';
  readonly type = 'message' as const;
  readonly scope = 'all' as const;
  readonly priority = 50; // Run after logger but before AI

  private context?: PluginContext;
  private service?: MediaService;

  async load(context: PluginContext): Promise<void> {
    this.context = context;
    this.service = new MediaService();
    context.logger.info('MediaAutoPlugin loaded');
  }

  async unload(): Promise<void> {
    this.context?.logger.info('MediaAutoPlugin unloaded');
    this.context = undefined;
  }

  shouldHandle(message: BotMessage): boolean {
    // Don't process bot messages
    if (message.author.isBot) return false;

    // Check if message contains Instagram or TikTok URLs
    return this.hasAutoProcessableUrl(message.content);
  }

  async handle(message: BotMessage, context: PluginContext): Promise<void> {
    const urls = this.extractUrls(message.content);

    for (const url of urls) {
      await this.processUrl(url, message, context);
    }
  }

  /**
   * Check if message contains Instagram or TikTok URLs (excluding live)
   */
  private hasAutoProcessableUrl(content: string): boolean {
    const lowerContent = content.toLowerCase();

    // Check for TikTok (but not live streams)
    if (lowerContent.includes('tiktok.com')) {
      if (lowerContent.includes('/live')) return false;
      return true;
    }

    // Check for Instagram (posts, reels, stories - but not live)
    if (lowerContent.includes('instagram.com')) {
      if (lowerContent.includes('/live')) return false;
      // Must have one of these patterns
      return lowerContent.includes('/p/') || lowerContent.includes('/reel/') || lowerContent.includes('/stories/');
    }

    return false;
  }

  /**
   * Extract processable URLs from message content
   */
  private extractUrls(content: string): string[] {
    const urlRegex = /https?:\/\/[^\s]+/gi;
    const matches = content.match(urlRegex) || [];

    return matches.filter((url) => {
      const lower = url.toLowerCase();

      // TikTok (exclude live)
      if (lower.includes('tiktok.com') && !lower.includes('/live')) {
        return true;
      }

      // Instagram (posts, reels, stories only)
      if (lower.includes('instagram.com')) {
        if (lower.includes('/live')) return false;
        return lower.includes('/p/') || lower.includes('/reel/') || lower.includes('/stories/');
      }

      return false;
    });
  }

  /**
   * Process a single URL
   */
  private async processUrl(url: string, message: BotMessage, context: PluginContext): Promise<void> {
    const platform = this.service?.getPlatform(url);
    if (!platform) return;

    context.logger.info('Auto-processing media URL', {
      platform,
      url: url.substring(0, 50),
      messageId: message.id,
    });

    // Suppress embeds on Discord
    if (message.platform === 'discord') {
      context.eventBus.fire('message:suppress-embeds', {
        channelId: message.channel.id,
        messageId: message.id,
        platform: message.platform,
      });
    }

    // Start typing indicator
    context.eventBus.fire('typing:start', {
      channelId: message.channel.id,
      platform: message.platform,
    });

    let result: MediaResult | null = null;

    try {
      result = (await this.service?.processMedia(url)) ?? null;

      if (!result || !result.success || result.items.length === 0) {
        context.logger.warn('Failed to process media URL', {
          platform,
          error: result?.error,
        });

        // Send error message
        context.eventBus.fire('message:send', {
          channelId: message.channel.id,
          message: {
            content: `❌ Could not process ${platform} link: ${result?.error || 'Unknown error'}`,
            replyToId: message.id,
          },
          platform: message.platform,
        });

        return;
      }

      // Build embed for nice presentation
      const metadata = result.metadata;
      const embed: import('@core').BotEmbed = {
        color: this.getPlatformColor(platform),
        url,
      };

      if (metadata?.description) {
        embed.description = metadata.description.substring(0, 2048); // Discord limit
      }

      if (metadata?.author) {
        embed.author = {
          name: metadata.author,
          url: metadata.authorUrl,
        };
      }

      if (metadata?.footer) {
        embed.footer = { text: metadata.footer };
      }

      // Send media files - read from disk, compress if needed
      const uploadLimit = this.getUploadLimit(message, context);
      const attachments: Array<{ data: Buffer; filename: string }> = [];
      const oversizedFiles: string[] = [];
      const compressedFiles: string[] = [];
      const compressionFailures: string[] = [];

      for (const item of result.items) {
        let buffer: Buffer;
        let filename: string;
        let filePath: string | undefined;

        if (item.localPath) {
          filePath = item.localPath;
          const file = Bun.file(item.localPath);
          buffer = Buffer.from(await file.arrayBuffer());
          filename = item.filename || 'media';
        } else if (item.buffer) {
          buffer = item.buffer;
          filename = item.filename || 'media';
        } else {
          throw new Error('Media item has neither localPath nor buffer');
        }

        // Check file size
        if (buffer.length > uploadLimit) {
          // Try to compress if it's a video and we have a file path
          const isVideo = filename.match(/\.(mp4|mov|avi|mkv|webm)$/i);
          if (isVideo && filePath) {
            context.logger.info('Compressing oversized video', {
              filename,
              originalSize: formatFileSize(buffer.length),
              targetSize: formatFileSize(uploadLimit),
            });

            const compressionResult = await compressVideo(filePath, {
              targetSizeBytes: uploadLimit * 0.95, // Target 95% of limit for safety
            });

            if (compressionResult.success && compressionResult.outputPath) {
              const compressedFile = Bun.file(compressionResult.outputPath);
              const compressedBuffer = Buffer.from(await compressedFile.arrayBuffer());

              if (compressedBuffer.length <= uploadLimit) {
                attachments.push({ data: compressedBuffer, filename });
                compressedFiles.push(
                  `${filename} (${formatFileSize(compressionResult.originalSize)} → ${formatFileSize(compressedBuffer.length)})`,
                );

                // Track compressed file for cleanup
                if (!result.tempFiles) result.tempFiles = [];
                result.tempFiles.push(compressionResult.outputPath);

                continue;
              } else {
                compressionFailures.push(
                  `${filename} (still ${formatFileSize(compressedBuffer.length)} after compression)`,
                );
              }
            } else {
              compressionFailures.push(`${filename} (${compressionResult.error || 'compression failed'})`);
            }
          }

          oversizedFiles.push(`${filename} (${formatFileSize(buffer.length)})`);
        } else {
          attachments.push({ data: buffer, filename });
        }
      }

      // Build compression/warning messages
      const statusMessages: string[] = [];
      if (compressedFiles.length > 0) {
        // Simple one-liner: just the size change
        const sizeInfo = compressedFiles.map((f) => f.replace(/^[^(]+/, '').replace(/[()]/g, ''));
        statusMessages.push(`🗜️ Compressed: ${sizeInfo.join(', ')}`);
      }
      if (compressionFailures.length > 0) {
        statusMessages.push(`⚠️ Failed to compress: ${compressionFailures.join(', ')}`);
      }
      if (oversizedFiles.length > 0 && compressionFailures.length === 0) {
        const limitMB = (uploadLimit / 1024 / 1024).toFixed(0);
        statusMessages.push(`⚠️ File(s) exceeded ${limitMB}MB limit: ${oversizedFiles.join(', ')}`);
      }

      // If ALL files are too large, send error and stop
      if (attachments.length === 0) {
        context.eventBus.fire('message:send', {
          channelId: message.channel.id,
          message: {
            content: statusMessages.join('\n'),
            replyToId: message.id,
          },
          platform: message.platform,
        });
        context.logger.warn('No files could be uploaded', { platform, uploadLimit });
        return;
      }

      // Discord has a 10 attachment limit per message - split into batches
      const MAX_ATTACHMENTS = 10;
      const batches: Array<Array<{ data: Buffer; filename: string }>> = [];
      for (let i = 0; i < attachments.length; i += MAX_ATTACHMENTS) {
        batches.push(attachments.slice(i, i + MAX_ATTACHMENTS));
      }

      const totalBatches = batches.length;

      // Send all batches except the last with simple "X of Y" message
      for (let i = 0; i < batches.length - 1; i++) {
        if (i > 0) {
          // Small delay between messages to avoid rate limiting
          await new Promise((resolve) => setTimeout(resolve, 500));
        }

        context.eventBus.fire('message:send', {
          channelId: message.channel.id,
          message: {
            content: `${i + 1} of ${totalBatches}`,
            attachments: batches[i],
            replyToId: i === 0 ? message.id : undefined,
          },
          platform: message.platform,
        });
      }

      // Small delay before final message
      if (totalBatches > 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      // Send last batch with embed and info
      const lastBatch = batches[batches.length - 1];
      context.eventBus.fire('message:send', {
        channelId: message.channel.id,
        message: {
          content: statusMessages.length > 0 ? statusMessages.join('\n') : undefined,
          embeds: [embed],
          attachments: lastBatch,
          replyToId: totalBatches === 1 ? message.id : undefined,
        },
        platform: message.platform,
      });

      // Cleanup temp files
      if (result.tempFiles && result.tempFiles.length > 0) {
        await this.service?.cleanup(result.tempFiles);
      }

      context.logger.info('Media processed successfully', {
        platform,
        itemCount: result.items.length,
      });
    } catch (error) {
      context.logger.error('Error processing media URL', {
        platform,
        error: error instanceof Error ? error.message : String(error),
      });

      context.eventBus.fire('message:send', {
        channelId: message.channel.id,
        message: {
          content: `❌ Error processing ${platform} link: ${error instanceof Error ? error.message : 'Unknown error'}`,
          replyToId: message.id,
        },
        platform: message.platform,
      });
    } finally {
      // Stop typing
      context.eventBus.fire('typing:stop', {
        channelId: message.channel.id,
        platform: message.platform,
      });
    }
  }

  /**
   * Get platform color for embeds
   */
  private getPlatformColor(platform: string): number {
    switch (platform) {
      case 'instagram':
        return 0xe1306c; // Instagram pink
      case 'tiktok':
        return 0x000000; // TikTok black
      case 'reddit':
        return 0xff4500; // Reddit orange
      default:
        return 0x5865f2; // Discord blurple
    }
  }

  /**
   * Get upload limit for the current context
   */
  private getUploadLimit(message: BotMessage, context: PluginContext): number {
    // Discord-specific - check guild upload limit
    if (message.platform === 'discord' && message.guildId) {
      const adapter = (context.eventBus as any).discordAdapter;
      if (adapter && typeof adapter.getGuildUploadLimit === 'function') {
        return adapter.getGuildUploadLimit(message.guildId);
      }
    }

    // Default to 10MB for other platforms or DMs
    return 10 * 1024 * 1024;
  }
}

export default MediaAutoPlugin;
