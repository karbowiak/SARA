/**
 * Media Service - Orchestrates platform handlers for downloading media
 * Lives in app/helpers/media/ for shared use across plugins and tools
 */

import { InstagramHandler } from './handlers/instagram.handler';
import { RedditHandler } from './handlers/reddit.handler';
import { TikTokHandler } from './handlers/tiktok.handler';
import type { MediaHandler, MediaResult, SocialPlatform } from './types';
import { cleanupFiles } from './utils/fileUtils';

export type { MediaResult, SocialPlatform } from './types';

export class MediaService {
  private handlers: MediaHandler[] = [];

  constructor() {
    this.handlers = [new InstagramHandler(), new TikTokHandler(), new RedditHandler()];
  }

  /**
   * Detect platform from URL
   */
  getPlatform(url: string): SocialPlatform | null {
    if (url.includes('instagram.com')) return 'instagram';
    if (url.includes('tiktok.com')) return 'tiktok';
    if (url.includes('reddit.com') || url.includes('redd.it')) return 'reddit';
    return null;
  }

  /**
   * Process a URL and download media files
   * Returns a MediaResult with either file paths or buffers ready to upload
   */
  async processMedia(url: string, _platform?: SocialPlatform): Promise<MediaResult> {
    console.log(`Processing URL: ${url}`);

    // Find appropriate handler
    const handler = this.handlers.find((h) => h.canHandle(url));
    if (!handler) {
      return {
        success: false,
        platform: 'twitter', // Default fallback
        items: [],
        error: 'No handler found for this URL',
      };
    }

    try {
      const result = await handler.process(url);
      return result;
    } catch (error) {
      console.error('Error processing media:', error);
      return {
        success: false,
        platform: 'twitter',
        items: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Cleanup temporary files after upload
   */
  async cleanup(tempFiles: string[]): Promise<void> {
    if (tempFiles.length > 0) {
      await cleanupFiles(tempFiles);
    }
  }
}
