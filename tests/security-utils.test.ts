/**
 * Security utilities tests
 */

import { describe, expect, test } from 'bun:test';
import {
  getSafeFilenameFromUrl,
  isTrustedMediaUrl,
  sanitizeFilename,
  validateFileExtension,
  validateFilePath,
  validateUrl,
} from '@app/helpers/media/utils/security';

describe('Security Utils', () => {
  describe('validateUrl', () => {
    test('should accept valid HTTPS URLs', () => {
      expect(validateUrl('https://tiktok.com/@user/video/123').valid).toBe(true);
      expect(validateUrl('https://instagram.com/p/123').valid).toBe(true);
    });

    test('should reject HTTP URLs', () => {
      const result = validateUrl('http://example.com/test');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('HTTPS');
    });

    test('should reject file:// protocol', () => {
      const result = validateUrl('file:///etc/passwd');
      expect(result.valid).toBe(false);
    });

    test('should reject private IP addresses', () => {
      expect(validateUrl('https://127.0.0.1/test').valid).toBe(false);
      expect(validateUrl('https://10.0.0.1/test').valid).toBe(false);
      expect(validateUrl('https://192.168.1.1/test').valid).toBe(false);
      expect(validateUrl('https://172.16.0.1/test').valid).toBe(false);
    });

    test('should reject localhost', () => {
      const result = validateUrl('https://localhost/test');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('not allowed');
    });

    test('should reject invalid URLs', () => {
      const result = validateUrl('not-a-url');
      expect(result.valid).toBe(false);
    });
  });

  describe('isTrustedMediaUrl', () => {
    test('should accept TikTok URLs', () => {
      const result = isTrustedMediaUrl('https://tiktok.com/@user/video/123');
      expect(result.valid).toBe(true);
    });

    test('should accept Instagram URLs', () => {
      const result = isTrustedMediaUrl('https://instagram.com/p/123');
      expect(result.valid).toBe(true);
    });

    test('should accept Reddit URLs', () => {
      expect(isTrustedMediaUrl('https://reddit.com/r/test/123').valid).toBe(true);
      expect(isTrustedMediaUrl('https://redd.it/123').valid).toBe(true);
    });

    test('should reject unknown domains', () => {
      const result = isTrustedMediaUrl('https://example.com/test');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Instagram, TikTok, and Reddit');
    });

    test('should require HTTPS', () => {
      const result = isTrustedMediaUrl('http://tiktok.com/test');
      expect(result.valid).toBe(false);
    });
  });

  describe('validateFilePath', () => {
    test('should accept safe paths within directory', () => {
      expect(validateFilePath('/tmp/test.txt', '/tmp')).toBe(true);
      expect(validateFilePath('/tmp/subdir/file.jpg', '/tmp')).toBe(true);
    });

    test('should reject path traversal with ../', () => {
      expect(validateFilePath('/tmp/../../../etc/passwd', '/tmp')).toBe(false);
      expect(validateFilePath('/tmp/subdir/../../etc/passwd', '/tmp')).toBe(false);
    });

    test('should reject absolute paths outside directory', () => {
      expect(validateFilePath('/etc/passwd', '/tmp')).toBe(false);
      expect(validateFilePath('/home/user/file.txt', '/tmp')).toBe(false);
    });
  });

  describe('sanitizeFilename', () => {
    test('should preserve safe filenames', () => {
      expect(sanitizeFilename('video.mp4')).toBe('video.mp4');
      expect(sanitizeFilename('image.jpg')).toBe('image.jpg');
    });

    test('should remove path separators', () => {
      expect(sanitizeFilename('path/to/file.mp4')).toBe('path_to_file.mp4');
      expect(sanitizeFilename('path\\to\\file.mp4')).toBe('path_to_file.mp4');
    });

    test('should remove special characters', () => {
      expect(sanitizeFilename('file@test#1.mp4')).toBe('file_test_1.mp4');
      expect(sanitizeFilename('file name.mp4')).toBe('file_name.mp4');
    });

    test('should prevent hidden files', () => {
      expect(sanitizeFilename('.hidden')).toBe('_hidden');
      expect(sanitizeFilename('.bashrc')).toBe('_bashrc');
    });

    test('should handle null bytes', () => {
      expect(sanitizeFilename('file\0name.txt')).toBe('filename.txt');
    });

    test('should not produce empty filenames', () => {
      expect(sanitizeFilename('')).toBe('unnamed');
      // '...' becomes '_..' after sanitization (special chars removed, dot-prefixed)
      expect(sanitizeFilename('...')).toBe('_..');
    });
  });

  describe('validateFileExtension', () => {
    test('should accept allowed extensions', () => {
      expect(validateFileExtension('mp4')).toBe(true);
      expect(validateFileExtension('jpg')).toBe(true);
      expect(validateFileExtension('png')).toBe(true);
      expect(validateFileExtension('gif')).toBe(true);
      expect(validateFileExtension('webp')).toBe(true);
    });

    test('should reject disallowed extensions', () => {
      expect(validateFileExtension('exe')).toBe(false);
      expect(validateFileExtension('sh')).toBe(false);
      expect(validateFileExtension('bat')).toBe(false);
    });
  });

  describe('getSafeFilenameFromUrl', () => {
    test('should extract filename from URL', () => {
      const filename = getSafeFilenameFromUrl('https://tiktok.com/@user/video/123.mp4');
      expect(filename).toBe('123.mp4');
    });

    test('should handle URLs without extensions', () => {
      const filename = getSafeFilenameFromUrl('https://instagram.com/p/123');
      expect(filename).toBe('123.mp4'); // defaults to mp4
    });

    test('should handle malformed URLs gracefully', () => {
      const filename = getSafeFilenameFromUrl('not-a-url');
      expect(filename).toMatch(/^media_\d+\.mp4$/);
    });
  });
});
