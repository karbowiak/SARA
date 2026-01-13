/**
 * Reddit Media Handler
 */

import type { MediaHandler, MediaItem, MediaMetadata } from '../types';

export class RedditHandler implements MediaHandler {
  name = 'Reddit';

  canHandle(url: string): boolean {
    return url.includes('reddit.com') || url.includes('redd.it');
  }

  async process(url: string): Promise<MediaMetadata | null> {
    try {
      // Clean URL and append .json
      const jsonUrl = new URL(url);
      jsonUrl.pathname = `${jsonUrl.pathname.replace(/\/$/, '')}.json`;
      jsonUrl.search = '';

      const response = await fetch(jsonUrl.toString(), {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      });

      if (!response.ok) return null;

      const data = await response.json();
      if (!Array.isArray(data) || !data[0]?.data?.children?.[0]?.data) return null;

      const post = data[0].data.children[0].data;
      const items: MediaItem[] = [];

      // Handle Gallery
      if (post.is_gallery && post.media_metadata) {
        for (const key of Object.keys(post.media_metadata)) {
          const item = post.media_metadata[key];
          // Prefer highest quality
          const mediaUrl = item.s?.u?.replace(/&amp;/g, '&') || item.s?.gif?.replace(/&amp;/g, '&');
          if (mediaUrl) {
            items.push({
              type: 'image',
              url: mediaUrl,
            });
          }
        }
      }
      // Handle Single Image/Video
      else if (post.url && (post.url.endsWith('.jpg') || post.url.endsWith('.png') || post.url.endsWith('.gif'))) {
        items.push({
          type: 'image',
          url: post.url,
        });
      } else if (post.is_video && post.media?.reddit_video?.fallback_url) {
        items.push({
          type: 'video',
          url: post.media.reddit_video.fallback_url.replace('?source=fallback', ''),
        });
      }

      if (items.length === 0) return null;

      return {
        platform: 'reddit',
        title: post.title,
        description: post.selftext?.substring(0, 200),
        author: post.author,
        authorUrl: `https://reddit.com/user/${post.author}`,
        originalUrl: `https://reddit.com${post.permalink}`,
        items,
        footer: `r/${post.subreddit}`,
      };
    } catch (error) {
      console.error('Reddit handler error:', error);
      return null;
    }
  }
}
