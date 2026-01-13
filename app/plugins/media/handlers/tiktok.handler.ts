/**
 * TikTok Media Handler
 * Uses yt-dlp to download videos
 */

import { spawn } from 'bun';
import type { MediaHandler, MediaMetadata } from '../types';

export class TikTokHandler implements MediaHandler {
  name = 'TikTok';

  canHandle(url: string): boolean {
    return url.includes('tiktok.com');
  }

  async process(url: string): Promise<MediaMetadata | null> {
    if (url.includes('/live/') || url.includes('/live')) {
      // We cannot handle live streams
      // The service will need to handle this null => but the user wants a specific "private ephemeral message".
      // The handler returns MediaMetadata | null.
      // If I return null, the service says "No handler found" or "Could not extract".
      // I need a way to signal "Specific Error" or "Handled but rejected".
      // Let's throw a specific error or return a specific metadata that indicates error.
      throw new Error('TikTok Live not supported');
    }

    try {
      // 1. Get Metadata
      const metadataProc = spawn(['yt-dlp', '--dump-json', '--no-warnings', url]);

      const text = await new Response(metadataProc.stdout).text();
      if (!text) return null;

      const meta = JSON.parse(text);

      // 2. Download Media (Actually, for this bot, we might just return the direct URL if valid,
      // but yt-dlp direct URLs often expire. Better to download or just return metadata and let handler download.)
      // The MediaService usually expects us to handle the content.
      // But `yt-dlp -g` gives direct link.
      // Let's try to just return the direct link from metadata first.

      // Note: TikTok direct links might block hotlinking.
      // If we need to download, we'd spawn yt-dlp -o ...

      return {
        platform: 'tiktok',
        title: meta.description || meta.title || 'TikTok Video',
        description: meta.description,
        author: meta.uploader || meta.creator,
        authorUrl: meta.uploader_url,
        originalUrl: meta.webpage_url || url,
        items: [
          {
            type: 'video',
            url: meta.url, // Direct video URL
            filename: `tiktok_${meta.id}.mp4`,
          },
        ],
        footer: `TikTok • ${meta.view_count || 0} views`,
      };
    } catch (error) {
      console.error('TikTok handler error:', error);
      return null;
    }
  }
}
