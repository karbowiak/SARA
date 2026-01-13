/**
 * Media Service - Logic for processing social media links
 */

import { InstagramHandler } from './handlers/instagram.handler';
import { RedditHandler } from './handlers/reddit.handler';
import { TikTokHandler } from './handlers/tiktok.handler';
import type { BotMessageContent, MediaHandler, MediaMetadata, SocialPlatform } from './types';

export class MediaService {
  private handlers: MediaHandler[] = [];

  constructor() {
    this.handlers = [new InstagramHandler(), new TikTokHandler(), new RedditHandler()];
  }

  getPlatform(url: string): SocialPlatform | null {
    if (url.includes('instagram.com')) return 'instagram';
    if (url.includes('tiktok.com')) return 'tiktok';
    if (url.includes('reddit.com') || url.includes('redd.it')) return 'reddit';
    return null;
  }

  async processMedia(url: string, platform: SocialPlatform): Promise<BotMessageContent[]> {
    console.log(`Processing ${platform} URL: ${url}`);

    const handler = this.handlers.find((h) => h.canHandle(url));
    if (!handler) {
      console.warn(`No handler found for ${url}`);
      return [];
    }

    try {
      const metadata = await handler.process(url);
      if (!metadata) {
        return [];
      }
      return this.formatResponse(metadata);
    } catch (error) {
      console.error('Error processing media:', error);
      return [];
    }
  }

  formatResponse(metadata: MediaMetadata): BotMessageContent[] {
    const messages: BotMessageContent[] = [];
    const MAX_FILES = 10;

    // Create base message content
    const baseContent = `**${metadata.title || 'Media Content'}**\n${metadata.description || ''}\nPosted by: ${metadata.author || 'Unknown'} - [Original](${metadata.originalUrl})`;

    // Extract file URLs
    const files = metadata.items.map((item) => item.url);

    if (files.length === 0) {
      return [{ content: baseContent }];
    }

    // First message
    messages.push({
      content: baseContent,
      files: files.slice(0, MAX_FILES),
    });

    // Subsequent messages
    for (let i = MAX_FILES; i < files.length; i += MAX_FILES) {
      messages.push({
        content: `(continued)...`,
        files: files.slice(i, i + MAX_FILES),
      });
    }

    return messages;
  }
}
