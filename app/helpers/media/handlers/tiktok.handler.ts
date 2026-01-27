/**
 * TikTok Media Handler
 * Uses yt-dlp to download videos to temp directory
 * Ported from Sarav2
 */

import { join } from 'node:path';
import { spawn } from 'bun';
import type { MediaHandler, MediaResult } from '../types';
import { ensureTempDirectory, getFileSize } from '../utils/fileUtils';
import { isTrustedMediaUrl } from '../utils/security';

const TEMP_DIR = '/tmp/tiktok';

export class TikTokHandler implements MediaHandler {
  name = 'TikTok';

  canHandle(url: string): boolean {
    return url.includes('tiktok.com');
  }

  async process(url: string): Promise<MediaResult> {
    // Validate URL for security
    const validation = isTrustedMediaUrl(url);
    if (!validation.valid) {
      return {
        success: false,
        platform: 'tiktok',
        items: [],
        error: validation.error || 'Invalid URL',
      };
    }

    // Reject TikTok Live
    if (url.includes('/live/') || url.includes('/live')) {
      return {
        success: false,
        platform: 'tiktok',
        items: [],
        error: 'TikTok Live streams are not supported',
      };
    }

    try {
      await ensureTempDirectory(TEMP_DIR);

      const timestamp = Date.now();
      const filePath = join(TEMP_DIR, `tiktok_${timestamp}.mp4`);

      // Download video using yt-dlp
      const downloadProc = spawn([
        'yt-dlp',
        '--no-playlist',
        '--format',
        'best[ext=mp4]/best',
        '--output',
        filePath,
        '--no-warnings',
        '--quiet',
        url,
      ]);

      // Add timeout for download (60 seconds)
      const timeoutPromise = new Promise<number>((resolve) => {
        const timeout = setTimeout(() => {
          downloadProc.kill();
          resolve(124); // Standard timeout exit code
        }, 60000);

        downloadProc.exited.then(() => {
          clearTimeout(timeout);
        });
      });

      const exitCode = await Promise.race([downloadProc.exited, timeoutPromise]);

      if (exitCode !== 0) {
        const stderr = await new Response(downloadProc.stderr).text();
        console.error('yt-dlp failed:', stderr);
        return {
          success: false,
          platform: 'tiktok',
          items: [],
          error: `Download failed: ${stderr.slice(0, 100)}`,
        };
      }

      // Get metadata
      let metadata: Record<string, unknown> = {};
      try {
        const metaProc = spawn(['yt-dlp', '--dump-json', '--no-warnings', url]);

        // Add timeout for metadata (30 seconds)
        const timeoutPromise = new Promise<Response>((resolve) => {
          const timeout = setTimeout(() => {
            metaProc.kill();
            resolve(new Response(null, { status: 408 })); // Request timeout
          }, 30000);

          metaProc.exited.then(() => {
            clearTimeout(timeout);
          });
        });

        const metaResponse = await Promise.race([new Response(metaProc.stdout), timeoutPromise]);
        const metaOutput = await metaResponse.text();

        if (metaOutput && metaResponse.ok) {
          metadata = JSON.parse(metaOutput);
        }
      } catch {
        // Metadata extraction failed, continue with file
      }

      const fileSize = await getFileSize(filePath);

      // Build description with stats
      const description = (metadata.description as string) || (metadata.title as string) || '';
      const stats: string[] = [];

      if (metadata.like_count) {
        stats.push(`❤️ ${this.formatNumber(metadata.like_count as number)}`);
      }
      if (metadata.comment_count) {
        stats.push(`💬 ${this.formatNumber(metadata.comment_count as number)}`);
      }
      if (metadata.view_count) {
        stats.push(`👁️ ${this.formatNumber(metadata.view_count as number)}`);
      }

      return {
        success: true,
        platform: 'tiktok',
        items: [
          {
            type: 'video',
            url,
            localPath: filePath,
            filename: `tiktok_${timestamp}.mp4`,
          },
        ],
        metadata: {
          description: description + (stats.length > 0 ? `\n\n${stats.join(' • ')}` : ''),
          author: (metadata.uploader as string) || (metadata.creator as string),
          authorUrl: metadata.uploader_url as string,
          footer: `TikTok • ${fileSize > 1024 * 1024 ? `${(fileSize / 1024 / 1024).toFixed(1)}MB` : `${(fileSize / 1024).toFixed(0)}KB`}`,
        },
        tempFiles: [filePath],
      };
    } catch (error) {
      console.error('TikTok handler error:', error);
      return {
        success: false,
        platform: 'tiktok',
        items: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
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
}
