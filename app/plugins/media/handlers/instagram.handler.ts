/**
 * Instagram Media Handler
 * Uses instagram-url-direct to extract media URLs
 */

// @ts-expect-error - no types for this package
import instagramGetUrl from 'instagram-url-direct';
import type { MediaHandler, MediaItem, MediaMetadata } from '../types';

export class InstagramHandler implements MediaHandler {
  name = 'Instagram';

  canHandle(url: string): boolean {
    return (
      url.includes('instagram.com') && (url.includes('/p/') || url.includes('/reel/') || url.includes('/stories/'))
    );
  }

  async process(url: string): Promise<MediaMetadata | null> {
    try {
      const result = await instagramGetUrl(url);

      if (!result || !result.url_list || result.url_list.length === 0) {
        return null;
      }

      const items: MediaItem[] = result.url_list.map((u: string) => ({
        type: 'image', // We don't know for sure, but discord usually handles direct links well
        url: u,
      }));

      // Try to determine type if possible, or just default to image/video based on extension or context
      // instagram-url-direct structure: { results_number: 1, url_list: ['...'] }
      // It doesn't give much metadata.

      return {
        platform: 'instagram',
        title: 'Instagram Content',
        originalUrl: url,
        items: items,
        footer: 'Instagram',
      };
    } catch (error) {
      console.error('Instagram handler error:', error);
      return null;
    }
  }
}
