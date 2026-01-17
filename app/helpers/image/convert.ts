/**
 * Image Conversion Helpers
 */

import sharp from 'sharp';

export async function convertToPng(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer, { failOnError: false }).png().toBuffer();
}

export async function getImageDimensions(buffer: Buffer): Promise<{ width: number; height: number } | null> {
  try {
    const meta = await sharp(buffer, { failOnError: false }).metadata();
    if (!meta.width || !meta.height) return null;
    return { width: meta.width, height: meta.height };
  } catch {
    return null;
  }
}
