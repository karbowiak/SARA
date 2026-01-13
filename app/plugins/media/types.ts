/**
 * Shared types for media handlers
 */

export type SocialPlatform = 'instagram' | 'tiktok' | 'reddit' | 'twitter';

export interface MediaItem {
  type: 'image' | 'video';
  url: string; // URL to download from
  filename?: string;
  buffer?: Buffer; // If already downloaded
  caption?: string;
}

export interface MediaMetadata {
  platform: SocialPlatform;
  title?: string;
  description?: string;
  author?: string;
  authorUrl?: string;
  items: MediaItem[]; // Items to upload
  originalUrl: string;
  footer?: string;
}

export interface MediaHandler {
  name: string;
  canHandle(url: string): boolean;
  process(url: string): Promise<MediaMetadata | null>;
}

export interface BotMessageContent {
  content: string;
  files?: (string | { attachment: Buffer; name: string })[];
}
