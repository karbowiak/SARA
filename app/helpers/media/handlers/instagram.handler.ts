/**
 * Instagram Media Handler
 * Uses instagram-url-direct with yt-dlp fallback
 * Ported from Sarav2
 */

import { join } from 'node:path';
import { getBotConfig } from '@core';
import { spawn } from 'bun';
// @ts-expect-error - no types for this package
import { instagramGetUrl } from 'instagram-url-direct';
import type { MediaHandler, MediaItem, MediaResult } from '../types';
import { downloadFile, ensureTempDirectory, getFileSize } from '../utils/fileUtils';

const TEMP_DIR = '/tmp/instagram';
const COOKIE_FILE = '/tmp/instagram_cookies.txt';

export class InstagramHandler implements MediaHandler {
  name = 'Instagram';
  private cookiesReady = false;

  canHandle(url: string): boolean {
    return (
      url.includes('instagram.com') && (url.includes('/p/') || url.includes('/reel/') || url.includes('/stories/'))
    );
  }

  /**
   * Ensure cookies file exists
   */
  private async ensureCookies(): Promise<boolean> {
    if (this.cookiesReady) return true;

    try {
      const config = getBotConfig();
      const cookiesB64 = config.tokens.instagramCookies;

      if (!cookiesB64) {
        console.warn('Instagram cookies not configured');
        return false;
      }

      // Decode and write cookies file
      const cookies = Buffer.from(cookiesB64, 'base64').toString('utf-8');
      await Bun.write(COOKIE_FILE, cookies);
      this.cookiesReady = true;
      return true;
    } catch (error) {
      console.error('Failed to write Instagram cookies:', error);
      return false;
    }
  }

  async process(url: string): Promise<MediaResult> {
    // Ensure cookies are ready (for yt-dlp fallback)
    await this.ensureCookies();

    // Try instagram-url-direct first (better for carousels and has metadata)
    let result = await this.downloadWithInstagramDirect(url);

    // Fallback to yt-dlp if needed
    if (!result.success) {
      result = await this.downloadWithYtDlp(url);
    }

    return result;
  }

  /**
   * Get metadata using yt-dlp (for video posts)
   */
  private async getMetadataFromYtDlp(url: string): Promise<Record<string, unknown>> {
    try {
      const args = ['yt-dlp', '--dump-json', '--no-download', '--no-warnings'];

      // Add cookies if available
      if (this.cookiesReady) {
        args.push('--cookies', COOKIE_FILE);
      }

      args.push(url);
      const metaProc = spawn(args);
      const metaOutput = await new Response(metaProc.stdout).text();
      if (metaOutput) {
        return JSON.parse(metaOutput);
      }
    } catch {
      // Metadata extraction failed
    }
    return {};
  }

  /**
   * Format numbers for display (1000 → 1K, 1000000 → 1M)
   */
  private formatNumber(num: number): string {
    if (num >= 1_000_000) {
      return `${(num / 1_000_000).toFixed(1)}M`;
    }
    if (num >= 1_000) {
      return `${(num / 1_000).toFixed(1)}K`;
    }
    return num.toString();
  }

  /**
   * Build metadata object with stats from instagram-url-direct response
   */
  private buildMetadataFromResponse(
    postInfo: { owner_username?: string; owner_fullname?: string; likes?: number; caption?: string } | undefined,
    items: MediaItem[],
    totalSize: number,
  ): MediaResult['metadata'] {
    const description = postInfo?.caption || '';
    const stats: string[] = [];

    if (postInfo?.likes && postInfo.likes > 0) {
      stats.push(`❤️ ${this.formatNumber(postInfo.likes)}`);
    }

    // Count media types
    const videoCount = items.filter((i) => i.type === 'video').length;
    const imageCount = items.filter((i) => i.type === 'image').length;
    const mediaParts: string[] = [];
    if (videoCount > 0) mediaParts.push(`${videoCount} video${videoCount > 1 ? 's' : ''}`);
    if (imageCount > 0) mediaParts.push(`${imageCount} image${imageCount > 1 ? 's' : ''}`);

    const sizeStr =
      totalSize > 1024 * 1024 ? `${(totalSize / 1024 / 1024).toFixed(1)}MB` : `${(totalSize / 1024).toFixed(0)}KB`;

    return {
      description: description + (stats.length > 0 ? `\n\n${stats.join(' • ')}` : ''),
      author: postInfo?.owner_fullname || postInfo?.owner_username,
      authorUrl: postInfo?.owner_username ? `https://instagram.com/${postInfo.owner_username}` : undefined,
      footer: `Instagram • ${mediaParts.join(', ')} • ${sizeStr}`,
    };
  }

  /**
   * Build metadata for yt-dlp fallback (video posts)
   */
  private buildMetadataFromYtDlp(
    metadata: Record<string, unknown>,
    items: MediaItem[],
    totalSize: number,
  ): MediaResult['metadata'] {
    const description = (metadata.description as string) || (metadata.title as string) || '';
    const stats: string[] = [];

    if (metadata.like_count && (metadata.like_count as number) > 0) {
      stats.push(`❤️ ${this.formatNumber(metadata.like_count as number)}`);
    }
    if (metadata.comment_count) {
      stats.push(`💬 ${this.formatNumber(metadata.comment_count as number)}`);
    }

    // Count media types
    const videoCount = items.filter((i) => i.type === 'video').length;
    const imageCount = items.filter((i) => i.type === 'image').length;
    const mediaParts: string[] = [];
    if (videoCount > 0) mediaParts.push(`${videoCount} video${videoCount > 1 ? 's' : ''}`);
    if (imageCount > 0) mediaParts.push(`${imageCount} image${imageCount > 1 ? 's' : ''}`);

    const sizeStr =
      totalSize > 1024 * 1024 ? `${(totalSize / 1024 / 1024).toFixed(1)}MB` : `${(totalSize / 1024).toFixed(0)}KB`;

    return {
      description: description + (stats.length > 0 ? `\n\n${stats.join(' • ')}` : ''),
      author: (metadata.uploader as string) || (metadata.channel as string),
      authorUrl: (metadata.uploader_url as string) || (metadata.channel_url as string),
      footer: `Instagram • ${mediaParts.join(', ')} • ${sizeStr}`,
    };
  }

  private async downloadWithInstagramDirect(url: string): Promise<MediaResult> {
    try {
      const result = await instagramGetUrl(url);

      if (!result || !result.url_list || result.url_list.length === 0) {
        return {
          success: false,
          platform: 'instagram',
          items: [],
          error: 'No media found',
        };
      }

      await ensureTempDirectory(TEMP_DIR);
      const timestamp = Date.now();
      const items: MediaItem[] = [];
      const tempFiles: string[] = [];
      let totalSize = 0;

      // Use media_details if available for better type detection
      const mediaDetails = result.media_details as Array<{ type: string; url: string }> | undefined;

      // Download each media item
      for (let i = 0; i < result.url_list.length; i++) {
        const mediaUrl = result.url_list[i] as string;
        const mediaDetail = mediaDetails?.[i];
        const isVideo = mediaDetail?.type === 'video' || mediaUrl.includes('.mp4') || mediaUrl.includes('video');
        const ext = isVideo ? 'mp4' : 'jpg';
        const filename = `instagram_${timestamp}_${i}.${ext}`;
        const filePath = join(TEMP_DIR, filename);

        try {
          await downloadFile(mediaUrl, filePath);
          const fileSize = await getFileSize(filePath);
          totalSize += fileSize;
          items.push({
            type: isVideo ? 'video' : 'image',
            url: mediaUrl,
            localPath: filePath,
            filename,
          });
          tempFiles.push(filePath);
        } catch (error) {
          console.error(`Failed to download Instagram media ${i}:`, error);
        }
      }

      if (items.length === 0) {
        return {
          success: false,
          platform: 'instagram',
          items: [],
          error: 'Failed to download media files',
        };
      }

      // Extract post_info from response for metadata
      const postInfo = result.post_info as
        | { owner_username?: string; owner_fullname?: string; likes?: number; caption?: string }
        | undefined;

      return {
        success: true,
        platform: 'instagram',
        items,
        metadata: this.buildMetadataFromResponse(postInfo, items, totalSize),
        tempFiles,
      };
    } catch (error) {
      console.error('instagram-url-direct failed:', error);
      return {
        success: false,
        platform: 'instagram',
        items: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private async downloadWithYtDlp(url: string): Promise<MediaResult> {
    try {
      // Get metadata first
      const metadata = await this.getMetadataFromYtDlp(url);

      await ensureTempDirectory(TEMP_DIR);
      const timestamp = Date.now();
      const outputTemplate = join(TEMP_DIR, `instagram_${timestamp}.%(ext)s`);

      // Build yt-dlp command with cookies if available
      const args = ['yt-dlp', '--output', outputTemplate, '--no-playlist', '--no-warnings', '--quiet'];

      if (this.cookiesReady) {
        args.push('--cookies', COOKIE_FILE);
      }

      args.push(url);

      // Download using yt-dlp
      const downloadProc = spawn(args);

      const exitCode = await downloadProc.exited;

      if (exitCode !== 0) {
        const stderr = await new Response(downloadProc.stderr).text();
        return {
          success: false,
          platform: 'instagram',
          items: [],
          error: `yt-dlp failed: ${stderr.slice(0, 100)}`,
        };
      }

      // Get extension from metadata or default to mp4
      const ext = (metadata.ext as string) || 'mp4';
      const filePath = join(TEMP_DIR, `instagram_${timestamp}.${ext}`);
      const fileSize = await getFileSize(filePath);

      const items: MediaItem[] = [
        {
          type: ext === 'mp4' ? 'video' : 'image',
          url,
          localPath: filePath,
          filename: `instagram_${timestamp}.${ext}`,
        },
      ];

      return {
        success: true,
        platform: 'instagram',
        items,
        metadata: this.buildMetadataFromYtDlp(metadata, items, fileSize),
        tempFiles: [filePath],
      };
    } catch (error) {
      console.error('yt-dlp fallback failed:', error);
      return {
        success: false,
        platform: 'instagram',
        items: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}
