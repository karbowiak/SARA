/**
 * Auto-Immich Plugin
 *
 * Automatically uploads images and videos from configured Discord channels
 * to Immich albums. Operates silently with console logging only.
 */

import { join } from 'node:path';
import { cleanupFiles, downloadFileCustom } from '@app/helpers/media/utils/fileUtils';
import type { BotMessage, MessageHandlerPlugin, PluginContext } from '@core';
import { getBotConfig, type ImmichChannelConfig } from '@core/config';
import { ImmichClient } from '@core/immich/immich-client';

// Supported media extensions
const IMAGE_EXTENSIONS = /\.(png|jpg|jpeg|gif|webp|bmp)$/i;
const VIDEO_EXTENSIONS = /\.(mp4|mov|avi|mkv|webm|gifv)$/i;

// Skip Discord CDN emojis/stickers (not user content)
const SKIP_PATTERNS = [
  /cdn\.discordapp\.com\/emojis\//i,
  /cdn\.discordapp\.com\/stickers\//i,
  /media\.discordapp\.net\/stickers\//i,
  /media\.discordapp\.net\/emojis\//i,
];

interface MediaItem {
  url: string;
  proxyUrl?: string;
  filename: string;
  source: 'attachment' | 'embed';
}

export class ImmichAutoPlugin implements MessageHandlerPlugin {
  readonly id = 'immich-auto';
  readonly type = 'message' as const;
  readonly scope = 'all' as const;
  readonly priority = 40; // Run before media plugin (50)

  private context?: PluginContext;
  private channelConfigs: Map<string, ImmichChannelConfig> = new Map();
  private immichClient?: ImmichClient;
  private enabled = false;

  async load(context: PluginContext): Promise<void> {
    this.context = context;

    const config = getBotConfig();
    if (!config.immich?.enabled || !config.immich.channels?.length) {
      context.logger.info('[Immich Auto] Disabled or no channels configured');
      return;
    }

    // Build channel lookup map (key = "guildId:channelId")
    for (const channelConfig of config.immich.channels) {
      const key = `${channelConfig.guildId}:${channelConfig.channelId}`;
      this.channelConfigs.set(key, channelConfig);
    }

    this.immichClient = new ImmichClient(context.logger);
    this.enabled = true;
    context.logger.info(`[Immich Auto] Monitoring ${this.channelConfigs.size} channel(s)`);
  }

  async unload(): Promise<void> {
    this.channelConfigs.clear();
    this.enabled = false;
    this.context?.logger.info('[Immich Auto] Unloaded');
  }

  shouldHandle(message: BotMessage): boolean {
    // Skip if not enabled
    if (!this.enabled) return false;

    // Skip bot messages
    if (message.author.isBot) return false;

    // Check if this channel is monitored
    const key = `${message.guildId}:${message.channel.id}`;
    if (!this.channelConfigs.has(key)) return false;

    // Check if message has any media
    return this.extractMedia(message).length > 0;
  }

  async handle(message: BotMessage, context: PluginContext): Promise<void> {
    const key = `${message.guildId}:${message.channel.id}`;
    const channelConfig = this.channelConfigs.get(key);
    if (!channelConfig || !this.immichClient) return;

    const media = this.extractMedia(message);
    if (media.length === 0) return;

    const config = getBotConfig();
    const archive = channelConfig.archive ?? config.immich?.archiveAssets ?? true;
    const visibility = archive ? 'archive' : 'timeline';

    for (const item of media) {
      await this.processMediaItem(item, channelConfig.album, visibility, message.timestamp, message.id);
    }
  }

  private extractMedia(message: BotMessage): MediaItem[] {
    const media: MediaItem[] = [];

    // Extract from attachments
    for (const attachment of message.attachments) {
      if (this.isMediaFile(attachment.filename) && !this.shouldSkip(attachment.proxyUrl || attachment.url)) {
        media.push({
          url: attachment.url,
          proxyUrl: attachment.proxyUrl,
          filename: attachment.filename,
          source: 'attachment',
        });
      }
    }

    // Extract from embeds (image previews)
    if (message.embeds) {
      for (const embed of message.embeds) {
        if (embed.image?.url && !this.shouldSkip(embed.image.url)) {
          const filename = this.getFilenameFromUrl(embed.image.url);
          if (this.isMediaFile(filename)) {
            media.push({
              url: embed.image.url,
              filename,
              source: 'embed',
            });
          }
        }
        // Also check thumbnail for video embeds
        if (embed.thumbnail?.url && !this.shouldSkip(embed.thumbnail.url)) {
          const filename = this.getFilenameFromUrl(embed.thumbnail.url);
          if (this.isMediaFile(filename)) {
            media.push({
              url: embed.thumbnail.url,
              filename,
              source: 'embed',
            });
          }
        }
      }
    }

    return media;
  }

  private isMediaFile(filename: string): boolean {
    return IMAGE_EXTENSIONS.test(filename) || VIDEO_EXTENSIONS.test(filename);
  }

  private shouldSkip(url: string): boolean {
    return SKIP_PATTERNS.some((pattern) => pattern.test(url));
  }

  private getFilenameFromUrl(url: string): string {
    try {
      const pathname = new URL(url).pathname;
      const filename = pathname.split('/').pop() || 'unknown';
      return filename.split('?')[0] || 'unknown'; // Remove query params
    } catch {
      return 'unknown';
    }
  }

  private async processMediaItem(
    item: MediaItem,
    album: string,
    visibility: 'archive' | 'timeline',
    timestamp: Date,
    messageId: string,
  ): Promise<void> {
    const downloadUrl = item.proxyUrl || item.url;

    // Generate unique filename with message ID prefix
    const uniqueFilename = `${messageId}_${item.filename}`;
    const tempPath = join('/tmp', 'immich-auto', uniqueFilename);

    try {
      // Download to temp file
      await downloadFileCustom(downloadUrl, tempPath, timestamp);

      // Upload to Immich
      const result = await this.immichClient!.uploadAsset(tempPath, timestamp, undefined, visibility);

      if (!result) {
        this.context?.logger.info(`[Immich Auto] Failed: ${item.filename} - upload returned null`);
        return;
      }

      if (result.status === 'duplicate') {
        this.context?.logger.debug(`[Immich Auto] Duplicate: ${item.filename}`);
      } else if (result.status === 'created') {
        this.context?.logger.info(`[Immich Auto] Uploaded: ${item.filename} -> ${album}`);

        // Add to album
        const albumId = await this.immichClient!.ensureAlbum(album);
        if (albumId) {
          await this.immichClient!.addAssetToAlbum(albumId, result.id);
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      // Check for duplicate error from Immich
      if (errorMessage.includes('duplicate')) {
        this.context?.logger.debug(`[Immich Auto] Duplicate: ${item.filename}`);
      } else {
        this.context?.logger.info(`[Immich Auto] Failed: ${item.filename} - ${errorMessage}`);
      }
    } finally {
      // Cleanup temp file
      await cleanupFiles([tempPath]);
    }
  }
}

export default ImmichAutoPlugin;
