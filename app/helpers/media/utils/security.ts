/**
 * Security Utilities for Media Operations
 *
 * Provides centralized validation for URLs, file paths, and filenames
 * to prevent SSRF, command injection, and path traversal attacks.
 */

import { relative, resolve } from 'node:path';

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Allowed domains for media downloads
 */
const ALLOWED_DOMAINS = [
  'tiktok.com',
  'www.tiktok.com',
  'instagram.com',
  'www.instagram.com',
  'reddit.com',
  'www.reddit.com',
  'redd.it',
] as const;

/**
 * Allowed file extensions for downloaded media
 */
const ALLOWED_EXTENSIONS = ['mp4', 'jpg', 'png', 'gif', 'jpeg', 'webp'] as const;

/**
 * Private IP ranges that should be blocked
 */
const PRIVATE_IP_PATTERNS = [
  /^127\./, // 127.0.0.0/8
  /^10\./, // 10.0.0.0/8
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0/12
  /^192\.168\./, // 192.168.0.0/16
  /^localhost$/i,
  /^::1$/, // IPv6 loopback
  /^0\.0\.0\.0$/, // IPv4 unspecified
  /^::$/, // IPv6 unspecified
] as const;

/**
 * Validate a URL for security issues
 *
 * @param url - The URL to validate
 * @param options - Validation options
 * @returns ValidationResult with valid flag and optional error message
 */
export function validateUrl(url: string, options: { allowPrivateIps?: boolean } = {}): ValidationResult {
  try {
    const parsed = new URL(url);

    // Only allow HTTPS
    if (parsed.protocol !== 'https:') {
      return {
        valid: false,
        error: 'URL must use HTTPS protocol',
      };
    }

    // Check for private IPs unless explicitly allowed
    if (!options.allowPrivateIps) {
      const hostname = parsed.hostname;
      for (const pattern of PRIVATE_IP_PATTERNS) {
        if (pattern.test(hostname)) {
          return {
            valid: false,
            error: 'Private IP addresses are not allowed',
          };
        }
      }
    }

    // Check for localhost
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
      return {
        valid: false,
        error: 'Localhost URLs are not allowed',
      };
    }

    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Invalid URL format',
    };
  }
}

/**
 * Check if a URL is from a trusted media platform
 *
 * @param url - The URL to check
 * @returns true if URL is from a trusted domain
 */
export function isTrustedMediaUrl(url: string): ValidationResult {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;

    // Check if domain is in allowed list
    if (!ALLOWED_DOMAINS.includes(hostname as (typeof ALLOWED_DOMAINS)[number])) {
      return {
        valid: false,
        error: 'Only Instagram, TikTok, and Reddit URLs are supported',
      };
    }

    // Must be HTTPS
    if (parsed.protocol !== 'https:') {
      return {
        valid: false,
        error: 'URL must use HTTPS protocol',
      };
    }

    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Invalid URL format',
    };
  }
}

/**
 * Validate that a file path is within an allowed directory
 * Prevents path traversal attacks
 *
 * @param filePath - The file path to validate
 * @param allowedDir - The directory that the path must be within
 * @returns true if path is safe, false otherwise
 */
export function validateFilePath(filePath: string, allowedDir: string): boolean {
  try {
    const resolvedPath = resolve(filePath);
    const resolvedAllowed = resolve(allowedDir);
    const relPath = relative(resolvedAllowed, resolvedPath);

    // Check if path escapes the allowed directory
    // - relPath starts with '..' means it goes up from allowedDir
    // - relPath starts with '/' means it's an absolute path outside
    if (relPath.startsWith('..') || relPath.startsWith('/') || relPath.startsWith('\\')) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Sanitize a filename by removing dangerous characters
 *
 * @param filename - The filename to sanitize
 * @returns A safe filename
 */
export function sanitizeFilename(filename: string): string {
  // Remove path separators and null bytes
  let sanitized = filename.replace(/[/\\]/g, '_').replace(/\0/g, '');

  // Remove dangerous characters but keep safe ones
  sanitized = sanitized.replace(/[^a-zA-Z0-9._-]/g, '_');

  // Prevent filename starting with dot (hidden files)
  if (sanitized.startsWith('.')) {
    sanitized = `_${sanitized.slice(1)}`;
  }

  // Prevent empty filename
  if (!sanitized) {
    sanitized = 'unnamed';
  }

  return sanitized;
}

/**
 * Validate a file extension against an allowlist
 *
 * @param ext - The file extension to validate (without dot)
 * @param allowedExts - Array of allowed extensions (default uses ALLOWED_EXTENSIONS)
 * @returns true if extension is allowed
 */
export function validateFileExtension(ext: string, allowedExts: readonly string[] = ALLOWED_EXTENSIONS): boolean {
  return allowedExts.includes(ext.toLowerCase());
}

/**
 * Get safe filename from URL
 *
 * @param url - The URL to generate filename from
 * @param defaultExt - Default extension if none found
 * @returns A safe filename
 */
export function getSafeFilenameFromUrl(url: string, defaultExt: string = 'mp4'): string {
  try {
    const parsed = new URL(url);
    const pathParts = parsed.pathname.split('/').filter(Boolean);
    const filename = pathParts[pathParts.length - 1] || 'media';

    // Extract extension if present
    const parts = filename.split('.');
    const ext = parts.length > 1 ? (parts.pop() ?? defaultExt) : defaultExt;
    const base = parts.join('.');

    const sanitizedBase = sanitizeFilename(base);
    const sanitizedExt = sanitizeFilename(ext);

    return `${sanitizedBase}.${sanitizedExt}`;
  } catch {
    return `media_${Date.now()}.${defaultExt}`;
  }
}
