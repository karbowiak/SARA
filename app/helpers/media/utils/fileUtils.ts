/**
 * File Management Utilities
 *
 * Handles temporary file operations for media downloads.
 * Ported from Sarav2.
 */

import { mkdir, stat, unlink, utimes, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { validateUrl } from './security';

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
 * Download a file from a URL to local path (restricted to /tmp for security)
 */
export async function downloadFile(url: string, outputPath: string, mtime?: Date): Promise<void> {
  try {
    // Validate URL for security
    const validation = validateUrl(url, { allowPrivateIps: false });
    if (!validation.valid) {
      throw new Error(validation.error || 'Invalid URL');
    }

    // Ensure output directory exists and validate output path
    const outputDir = dirname(outputPath);
    await ensureTempDirectory(outputDir);

    // Validate output path is within temp directory (path traversal protection)
    const resolvedPath = resolve(outputPath);
    const resolvedAllowed = resolve('/tmp');
    const relPath = relative(resolvedAllowed, resolvedPath);

    if (relPath.startsWith('..') || relPath.startsWith('/') || relPath.startsWith('\\')) {
      throw new Error('Invalid output path: path traversal detected');
    }

    // Create AbortController for timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      // Download file using fetch with timeout
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        },
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Get file content as ArrayBuffer
      const buffer = await response.arrayBuffer();

      // Write to file
      await writeFile(outputPath, Buffer.from(buffer));

      // Set modification time if provided
      if (mtime) {
        await utimes(outputPath, mtime, mtime);
      }
    } catch (error) {
      clearTimeout(timeout);
      throw error;
    }
  } catch (error) {
    throw new Error(`Failed to download file from ${url}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Download a file from a URL to any local path (caller responsible for path safety)
 */
export async function downloadFileCustom(url: string, outputPath: string, mtime?: Date): Promise<void> {
  try {
    // Validate URL for security
    const validation = validateUrl(url, { allowPrivateIps: false });
    if (!validation.valid) {
      throw new Error(validation.error || 'Invalid URL');
    }

    // Ensure output directory exists
    const outputDir = dirname(outputPath);
    await ensureTempDirectory(outputDir);

    // Create AbortController for timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      // Download file using fetch with timeout
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        },
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Get file content as ArrayBuffer
      const buffer = await response.arrayBuffer();

      // Write to file
      await writeFile(outputPath, Buffer.from(buffer));

      // Set modification time if provided
      if (mtime) {
        await utimes(outputPath, mtime, mtime);
      }
    } catch (error) {
      clearTimeout(timeout);
      throw error;
    }
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
