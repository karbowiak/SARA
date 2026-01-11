/**
 * Image Generation Types
 *
 * Shared types for image generation across AI tools and slash commands.
 */

/**
 * Supported aspect ratios with their pixel dimensions
 */
export type AspectRatio = '1:1' | '2:3' | '3:2' | '3:4' | '4:3' | '4:5' | '5:4' | '9:16' | '16:9' | '21:9';

/**
 * Aspect ratio to pixel dimensions mapping
 */
export const ASPECT_RATIO_DIMENSIONS: Record<AspectRatio, { width: number; height: number }> = {
  '1:1': { width: 1024, height: 1024 },
  '2:3': { width: 832, height: 1248 },
  '3:2': { width: 1248, height: 832 },
  '3:4': { width: 864, height: 1184 },
  '4:3': { width: 1184, height: 864 },
  '4:5': { width: 896, height: 1152 },
  '5:4': { width: 1152, height: 896 },
  '9:16': { width: 768, height: 1344 },
  '16:9': { width: 1344, height: 768 },
  '21:9': { width: 1536, height: 672 },
};

/**
 * Human-readable aspect ratio labels
 */
export const ASPECT_RATIO_LABELS: Record<AspectRatio, string> = {
  '1:1': 'Square',
  '2:3': 'Portrait',
  '3:2': 'Landscape',
  '3:4': 'Portrait (4:3)',
  '4:3': 'Landscape (4:3)',
  '4:5': 'Portrait (Instagram)',
  '5:4': 'Landscape (5:4)',
  '9:16': 'Phone/Stories',
  '16:9': 'Widescreen',
  '21:9': 'Ultrawide',
};

/**
 * Supported image resolutions
 */
export type ImageResolution = '1K' | '2K' | '4K';

/**
 * Request for image generation
 */
export interface ImageGenerationRequest {
  /** The prompt describing the image to generate */
  prompt: string;
  /** Aspect ratio (default: 1:1) */
  aspectRatio?: AspectRatio;
  /** Resolution quality (default: 1K) */
  resolution?: ImageResolution;
  /** URL of a reference image to use/modify */
  referenceImageUrl?: string;
  /** Optional style hint */
  style?: string;
}

/**
 * Result of image generation
 */
export interface ImageGenerationResult {
  /** Whether generation succeeded */
  success: boolean;
  /** Generated image as a buffer (if successful) */
  imageBuffer?: Buffer;
  /** Error message (if failed) */
  error?: string;
  /** Model used for generation */
  model: string;
  /** The prompt that was used (may be enhanced) */
  prompt: string;
  /** Final aspect ratio used */
  aspectRatio: AspectRatio;
  /** Final resolution used */
  resolution: ImageResolution;
}

/**
 * Check if a string is a valid aspect ratio
 */
export function isValidAspectRatio(value: string): value is AspectRatio {
  return value in ASPECT_RATIO_DIMENSIONS;
}

/**
 * Check if a string is a valid resolution
 */
export function isValidResolution(value: string): value is ImageResolution {
  return ['1K', '2K', '4K'].includes(value);
}

/**
 * Get the next higher resolution
 */
export function getHigherResolution(current: ImageResolution): ImageResolution {
  switch (current) {
    case '1K':
      return '2K';
    case '2K':
      return '4K';
    case '4K':
      return '4K'; // Already max
  }
}
