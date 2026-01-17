/**
 * File Management Utilities
 *
 * Handles temporary file operations for media downloads.
 * Ported from Sarav2.
 */

import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Ensure a directory exists, creating it recursively if needed
 */
export async function ensureTempDirectory(path: string): Promise<void> {
  try {
    await mkdir(path, { recursive: true });
  } catch (error) {
    throw new Error(`Failed to create directory ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Cleanup temporary files
 */
export async function cleanupFiles(filePaths: string[]): Promise<void> {
  const deletePromises = filePaths.map(async (filePath) => {
    try {
      await unlink(filePath);
    } catch {
      // Ignore errors (file might not exist)
    }
  });

  await Promise.all(deletePromises);
}

/**
 * Download a file from a URL to local path
 */
export async function downloadFile(url: string, outputPath: string): Promise<void> {
  try {
    // Ensure output directory exists
    const outputDir = dirname(outputPath);
    await ensureTempDirectory(outputDir);

    // Download file using fetch
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // Get file content as ArrayBuffer
    const buffer = await response.arrayBuffer();

    // Write to file
    await writeFile(outputPath, new Uint8Array(buffer));
  } catch (error) {
    throw new Error(`Failed to download file from ${url}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get file size in bytes
 */
export async function getFileSize(filePath: string): Promise<number> {
  try {
    const stats = await stat(filePath);
    return stats.size;
  } catch (error) {
    throw new Error(
      `Failed to get file size for ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Check if a file exists
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}
