/**
 * Video compression utility using ffmpeg
 */

import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { $ } from 'bun';

export interface CompressionOptions {
  targetSizeBytes?: number;
  maxBitrate?: string;
  crf?: number;
}

export interface CompressionResult {
  success: boolean;
  outputPath?: string;
  originalSize: number;
  compressedSize?: number;
  error?: string;
}

/**
 * Compress video to fit within size limit
 */
export async function compressVideo(inputPath: string, options: CompressionOptions = {}): Promise<CompressionResult> {
  try {
    // Check if ffmpeg is available
    const ffmpegCheck = await $`which ffmpeg`.quiet().nothrow();
    if (!ffmpegCheck.stdout.toString().trim()) {
      return {
        success: false,
        originalSize: 0,
        error: 'ffmpeg not installed',
      };
    }

    const originalSize = (await Bun.file(inputPath).size) || 0;

    // Generate output path
    const outputPath = path.join(tmpdir(), `compressed_${randomBytes(8).toString('hex')}.mp4`);

    // Calculate target bitrate if size limit is specified
    let bitrate = options.maxBitrate || '1000k';
    if (options.targetSizeBytes) {
      // Get video duration
      const probeResult =
        await $`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 ${inputPath}`.quiet();
      const duration = parseFloat(probeResult.stdout.toString().trim());

      if (duration > 0) {
        // Calculate bitrate: (target_size * 8) / duration
        // Reserve 20% for audio and overhead
        const targetBitrate = Math.floor((options.targetSizeBytes * 8 * 0.8) / duration);
        bitrate = `${Math.max(500, targetBitrate)}`;
      }
    }

    // Compress with ffmpeg
    // -crf: Constant Rate Factor (18-28 is good, lower = better quality)
    // -preset: Encoding speed (ultrafast, fast, medium, slow)
    // -movflags +faststart: Web optimization
    const crf = options.crf || 28;

    await $`ffmpeg -i ${inputPath} -c:v libx264 -crf ${crf} -b:v ${bitrate} -maxrate ${bitrate} -bufsize ${bitrate} -preset fast -c:a aac -b:a 128k -movflags +faststart ${outputPath}`.quiet();

    const compressedSize = (await Bun.file(outputPath).size) || 0;

    return {
      success: true,
      outputPath,
      originalSize,
      compressedSize,
    };
  } catch (error) {
    return {
      success: false,
      originalSize: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
