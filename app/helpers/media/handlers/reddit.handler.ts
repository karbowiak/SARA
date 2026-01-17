/**
 * Reddit Media Handler
 * Downloads media files to buffer for Discord upload
 * Ported from Sarav2
 */

import type { MediaHandler, MediaItem, MediaResult } from '../types';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export class RedditHandler implements MediaHandler {
  name = 'Reddit';

  canHandle(url: string): boolean {
    return url.includes('reddit.com') || url.includes('redd.it');
  }

  async process(url: string): Promise<MediaResult> {
    try {
      // Clean URL and append .json
      const jsonUrl = new URL(url);
      jsonUrl.pathname = `${jsonUrl.pathname.replace(/\/$/, '')}.json`;
      jsonUrl.search = '';

      const response = await fetch(jsonUrl.toString(), {
        headers: { 'User-Agent': USER_AGENT },
      });

      if (!response.ok) {
        return {
          success: false,
          platform: 'reddit',
          items: [],
          error: `Reddit API error: ${response.status}`,
        };
      }

      const data = await response.json();
      if (!Array.isArray(data) || !data[0]?.data?.children?.[0]?.data) {
        return {
          success: false,
          platform: 'reddit',
          items: [],
          error: 'Invalid Reddit response',
        };
      }

      const post = data[0].data.children[0].data;
      const mediaUrls = this.extractMediaUrls(post);

      if (mediaUrls.length === 0) {
        return {
          success: false,
          platform: 'reddit',
          items: [],
          error: 'No downloadable media found in post',
        };
      }

      // Download all media to buffers
      const items: MediaItem[] = [];
      for (let i = 0; i < mediaUrls.length; i++) {
        const { url: mediaUrl, type } = mediaUrls[i];
        try {
          const buffer = await this.downloadToBuffer(mediaUrl);
          const ext = type === 'video' ? 'mp4' : 'jpg';
          items.push({
            type,
            url: mediaUrl,
            buffer,
            filename: `reddit_${i + 1}.${ext}`,
          });
        } catch (error) {
          console.error(`Failed to download Reddit media ${i}:`, error);
        }
      }

      if (items.length === 0) {
        return {
          success: false,
          platform: 'reddit',
          items: [],
          error: 'Failed to download any media',
        };
      }

      return {
        success: true,
        platform: 'reddit',
        items,
        isNsfw: post.over_18 === true,
        metadata: {
          title: post.title,
          description: post.selftext?.substring(0, 200),
          author: post.author,
          authorUrl: `https://reddit.com/user/${post.author}`,
          footer: `r/${post.subreddit} • ${items.length} item${items.length > 1 ? 's' : ''}`,
        },
      };
    } catch (error) {
      console.error('Reddit handler error:', error);
      return {
        success: false,
        platform: 'reddit',
        items: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private extractMediaUrls(post: Record<string, unknown>): Array<{ url: string; type: 'image' | 'video' }> {
    const urls: Array<{ url: string; type: 'image' | 'video' }> = [];

    // Handle Gallery
    if (post.is_gallery && post.media_metadata) {
      const metadata = post.media_metadata as Record<string, { s?: { u?: string; gif?: string } }>;
      for (const key of Object.keys(metadata)) {
        const item = metadata[key];
        const mediaUrl = item?.s?.u?.replace(/&amp;/g, '&') || item?.s?.gif?.replace(/&amp;/g, '&');
        if (mediaUrl) {
          urls.push({ url: mediaUrl, type: 'image' });
        }
      }
    }
    // Handle Single Image
    else if (typeof post.url === 'string' && /\.(jpg|png|gif|jpeg|webp)$/i.test(post.url)) {
      urls.push({ url: post.url, type: 'image' });
    }
    // Handle Reddit Video
    else if (
      post.is_video &&
      (post.media as { reddit_video?: { fallback_url?: string } })?.reddit_video?.fallback_url
    ) {
      const videoUrl = (post.media as { reddit_video: { fallback_url: string } }).reddit_video.fallback_url.replace(
        '?source=fallback',
        '',
      );
      urls.push({ url: videoUrl, type: 'video' });
    }
    // Handle preview images (fallback)
    else if ((post.preview as { images?: Array<{ source?: { url?: string } }> })?.images?.[0]?.source?.url) {
      const previewUrl = (post.preview as { images: Array<{ source: { url: string } }> }).images[0].source.url.replace(
        /&amp;/g,
        '&',
      );
      urls.push({ url: previewUrl, type: 'image' });
    }

    return urls;
  }

  private async downloadToBuffer(url: string): Promise<Buffer> {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}
