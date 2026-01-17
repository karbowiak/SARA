/**
 * Shared types for media handlers
 */

export type SocialPlatform = 'instagram' | 'tiktok' | 'reddit' | 'twitter';

export interface MediaItem {
  type: 'image' | 'video';
  url: string; // Original URL
  localPath?: string; // Local file path after download
  buffer?: Buffer; // If already downloaded to memory
  filename?: string;
  caption?: string;
}

export interface MediaResult {
  success: boolean;
  platform: SocialPlatform;
  items: MediaItem[];
  metadata?: {
    title?: string;
    description?: string;
    author?: string;
    authorUrl?: string;
    footer?: string;
  };
  /** Whether the content is NSFW/age-restricted */
  isNsfw?: boolean;
  error?: string;
  /** Files to cleanup after upload */
  tempFiles?: string[];
}

export interface MediaHandler {
  name: string;
  canHandle(url: string): boolean;
  process(url: string): Promise<MediaResult>;
}

export interface BotMessageContent {
  content: string;
  files?: (string | { attachment: Buffer; name: string })[];
}

// Legacy type for backwards compatibility
export interface MediaMetadata {
  platform: SocialPlatform;
  title?: string;
  description?: string;
  author?: string;
  authorUrl?: string;
  items: MediaItem[];
  originalUrl: string;
  footer?: string;
}
