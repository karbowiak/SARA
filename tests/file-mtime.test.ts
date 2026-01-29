import { describe, expect, test } from 'bun:test';
import { mkdir, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { downloadFileCustom } from '../app/helpers/media/utils/fileUtils';

describe('File Download with Modification Time', () => {
  const tempDir = join(tmpdir(), 'bot-test-mtime');
  const testUrl = 'https://httpbun.com/html'; // Simple test URL that returns HTML

  test('should set file modification time when mtime is provided', async () => {
    await mkdir(tempDir, { recursive: true });

    const testTime = new Date('2024-01-15T10:30:00Z');
    const outputPath = join(tempDir, 'test-with-mtime.html');

    try {
      await downloadFileCustom(testUrl, outputPath, testTime);

      const stats = await stat(outputPath);

      expect(stats.mtime.getTime()).toBe(testTime.getTime());
      expect(stats.atime.getTime()).toBe(testTime.getTime());
    } finally {
      await unlink(outputPath).catch(() => {});
    }
  });

  test('should use current time when mtime is not provided', async () => {
    await mkdir(tempDir, { recursive: true });

    const beforeTime = new Date();
    const outputPath = join(tempDir, 'test-without-mtime.html');

    try {
      await downloadFileCustom(testUrl, outputPath);

      const afterTime = new Date();
      const stats = await stat(outputPath);

      expect(stats.mtime.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
      expect(stats.mtime.getTime()).toBeLessThanOrEqual(afterTime.getTime());
    } finally {
      await unlink(outputPath).catch(() => {});
    }
  });
});
