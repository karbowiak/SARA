/**
 * URL Reader Tool - Fetch and extract readable content from web pages
 *
 * Supports HTML pages (via Readability), JSON, and plain text.
 * Includes safety measures to prevent SSRF attacks.
 */

import type { Tool, ToolExecutionContext, ToolMetadata, ToolResult, ToolSchema } from '@core';
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { z } from 'zod';

/** Maximum response size in bytes (500KB) */
const MAX_RESPONSE_SIZE = 500 * 1024;

/** Maximum extracted content length in characters */
const MAX_CONTENT_LENGTH = 50_000;

/** Request timeout in milliseconds */
const TIMEOUT_MS = 10_000;

/** Blocked URL schemes */
const BLOCKED_SCHEMES = ['file:', 'javascript:', 'data:'];

/** Patterns for blocked hosts (localhost, private IPs) */
const BLOCKED_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^0\.0\.0\.0$/,
  /^192\.168\.\d{1,3}\.\d{1,3}$/,
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/,
  /^\[?::1\]?$/,
  /^\[?fe80:/i,
  /^\[?fc00:/i,
  /^\[?fd00:/i,
];

/**
 * Check if a URL is safe to fetch (not a local/private resource)
 */
function isUrlSafe(urlString: string): { safe: boolean; reason?: string } {
  // Check for blocked schemes
  const lowerUrl = urlString.toLowerCase();
  for (const scheme of BLOCKED_SCHEMES) {
    if (lowerUrl.startsWith(scheme)) {
      return { safe: false, reason: `Blocked URL scheme: ${scheme}` };
    }
  }

  // Parse URL to check host
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return { safe: false, reason: 'Invalid URL format' };
  }

  // Must be http or https
  if (!['http:', 'https:'].includes(url.protocol)) {
    return { safe: false, reason: `Blocked URL scheme: ${url.protocol}` };
  }

  // Check hostname against blocked patterns
  const hostname = url.hostname;
  for (const pattern of BLOCKED_HOST_PATTERNS) {
    if (pattern.test(hostname)) {
      return { safe: false, reason: 'Cannot access localhost or private IP addresses' };
    }
  }

  return { safe: true };
}

/**
 * Convert HTML to simple markdown-like format
 */
function htmlToMarkdown(html: string): string {
  // Simple conversion - linkedom doesn't fully support textContent on all nodes
  // So we do basic tag replacement
  return html
    .replace(/<h1[^>]*>(.*?)<\/h1>/gi, '\n# $1\n')
    .replace(/<h2[^>]*>(.*?)<\/h2>/gi, '\n## $1\n')
    .replace(/<h3[^>]*>(.*?)<\/h3>/gi, '\n### $1\n')
    .replace(/<h4[^>]*>(.*?)<\/h4>/gi, '\n#### $1\n')
    .replace(/<h5[^>]*>(.*?)<\/h5>/gi, '\n##### $1\n')
    .replace(/<h6[^>]*>(.*?)<\/h6>/gi, '\n###### $1\n')
    .replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**')
    .replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**')
    .replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*')
    .replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*')
    .replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`')
    .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)')
    .replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<p[^>]*>(.*?)<\/p>/gi, '\n$1\n')
    .replace(/<blockquote[^>]*>(.*?)<\/blockquote>/gi, '\n> $1\n')
    .replace(/<[^>]+>/g, '') // Remove remaining tags
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n') // Collapse multiple newlines
    .trim();
}

/**
 * Count words in a string
 */
function countWords(text: string): number {
  return text.split(/\s+/).filter((word) => word.length > 0).length;
}

/**
 * Truncate text to a maximum length, preserving word boundaries
 */
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;

  const truncated = text.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');

  if (lastSpace > maxLength * 0.8) {
    return `${truncated.slice(0, lastSpace)}...`;
  }

  return `${truncated}...`;
}

export class UrlReaderTool implements Tool {
  readonly metadata: ToolMetadata = {
    name: 'read_url',
    description: 'Fetch and extract readable content from a web page URL',
    version: '1.0.0',
    author: 'system',
    keywords: ['url', 'web', 'page', 'read', 'fetch', 'content', 'article'],
    category: 'information',
    priority: 5,
  };

  readonly schema: ToolSchema = {
    type: 'function',
    name: 'read_url',
    description: 'Fetch and extract readable content from a URL. Returns the main text content in markdown format.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to fetch and read',
        },
      },
      required: ['url'],
      additionalProperties: false,
    },
    strict: true,
  };

  validate(): boolean {
    return true; // Always available
  }

  // Zod schema for input validation
  private readonly argsSchema = z.object({
    url: z.string().min(1).max(2048),
  });

  async execute(args: unknown, context: ToolExecutionContext): Promise<ToolResult> {
    // Validate input
    const parseResult = this.argsSchema.safeParse(args);
    if (!parseResult.success) {
      return {
        success: false,
        error: {
          type: 'validation_error',
          message: `Invalid parameters: ${parseResult.error.message}`,
        },
      };
    }

    const { url } = parseResult.data;

    // Safety check
    const safetyCheck = isUrlSafe(url);
    if (!safetyCheck.safe) {
      return {
        success: false,
        error: {
          type: 'security_error',
          message: safetyCheck.reason ?? 'URL blocked for security reasons',
        },
      };
    }

    context.logger.info('UrlReaderTool: Fetching URL', { url });

    try {
      // Fetch with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

      let response: Response;
      try {
        response = await fetch(url, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; Bot/1.0; +https://github.com)',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,application/json;q=0.7',
          },
          redirect: 'follow',
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response.ok) {
        return {
          success: false,
          error: {
            type: 'fetch_error',
            message: `HTTP ${response.status}: ${response.statusText}`,
            retryable: response.status >= 500,
          },
        };
      }

      // Check content length
      const contentLength = response.headers.get('content-length');
      if (contentLength && parseInt(contentLength, 10) > MAX_RESPONSE_SIZE) {
        return {
          success: false,
          error: {
            type: 'size_error',
            message: `Response too large: ${Math.round(parseInt(contentLength, 10) / 1024)}KB exceeds ${MAX_RESPONSE_SIZE / 1024}KB limit`,
          },
        };
      }

      // Get content type
      const contentType = response.headers.get('content-type') ?? '';

      // Read response body with size limit
      const reader = response.body?.getReader();
      if (!reader) {
        return {
          success: false,
          error: {
            type: 'fetch_error',
            message: 'No response body',
          },
        };
      }

      const chunks: Uint8Array[] = [];
      let totalSize = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        totalSize += value.length;
        if (totalSize > MAX_RESPONSE_SIZE) {
          reader.cancel();
          return {
            success: false,
            error: {
              type: 'size_error',
              message: `Response too large: exceeds ${MAX_RESPONSE_SIZE / 1024}KB limit`,
            },
          };
        }

        chunks.push(value);
      }

      const bodyBuffer = new Uint8Array(totalSize);
      let offset = 0;
      for (const chunk of chunks) {
        bodyBuffer.set(chunk, offset);
        offset += chunk.length;
      }

      const bodyText = new TextDecoder('utf-8').decode(bodyBuffer);

      // Process based on content type
      if (contentType.includes('application/json')) {
        return this.processJson(bodyText, url);
      } else if (contentType.includes('text/plain')) {
        return this.processPlainText(bodyText, url);
      } else if (contentType.includes('text/html') || contentType.includes('application/xhtml')) {
        return this.processHtml(bodyText, url, context);
      } else {
        return {
          success: false,
          error: {
            type: 'content_type_error',
            message: `Cannot read binary/unsupported content type: ${contentType}`,
          },
        };
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return {
          success: false,
          error: {
            type: 'timeout_error',
            message: `Request timed out after ${TIMEOUT_MS / 1000} seconds`,
            retryable: true,
          },
        };
      }

      context.logger.error('UrlReaderTool: Fetch failed', {
        url,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        success: false,
        error: {
          type: 'fetch_error',
          message: error instanceof Error ? error.message : String(error),
          retryable: true,
        },
      };
    }
  }

  /**
   * Process HTML content using Readability
   */
  private processHtml(html: string, url: string, context: ToolExecutionContext): ToolResult {
    try {
      // Parse HTML with linkedom
      const { document } = parseHTML(html);

      // Set documentURI for Readability (required for proper URL resolution)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (document as any).documentURI = url;

      // Extract with Readability
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const reader = new Readability(document as any);
      const article = reader.parse();

      if (!article || !article.content) {
        // Fallback: try to get basic content
        const title = document.querySelector('title')?.textContent ?? '';
        const bodyText = document.body?.textContent ?? '';

        if (!bodyText.trim()) {
          return {
            success: false,
            error: {
              type: 'extraction_error',
              message: 'Could not extract readable content from the page',
            },
          };
        }

        const content = truncateText(bodyText.trim(), MAX_CONTENT_LENGTH);
        return {
          success: true,
          data: {
            title: title || 'Untitled',
            url,
            content,
            wordCount: countWords(content),
            note: 'Extracted basic text content (Readability extraction failed)',
          },
        };
      }

      // Convert article HTML to markdown
      const markdown = htmlToMarkdown(article.content);
      const content = truncateText(markdown, MAX_CONTENT_LENGTH);

      context.logger.info('UrlReaderTool: Extracted article', {
        url,
        title: article.title,
        wordCount: countWords(content),
      });

      return {
        success: true,
        data: {
          title: article.title || 'Untitled',
          ...(article.byline && { byline: article.byline }),
          url,
          content,
          wordCount: countWords(content),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: {
          type: 'extraction_error',
          message: `Failed to extract content: ${error instanceof Error ? error.message : String(error)}`,
        },
      };
    }
  }

  /**
   * Process JSON content
   */
  private processJson(json: string, url: string): ToolResult {
    try {
      const parsed = JSON.parse(json);
      const pretty = JSON.stringify(parsed, null, 2);
      const content = truncateText(pretty, MAX_CONTENT_LENGTH);

      return {
        success: true,
        data: {
          title: 'JSON Response',
          url,
          content,
          wordCount: countWords(content),
        },
      };
    } catch {
      // If JSON parsing fails, treat as plain text
      const content = truncateText(json, MAX_CONTENT_LENGTH);
      return {
        success: true,
        data: {
          title: 'JSON Response (malformed)',
          url,
          content,
          wordCount: countWords(content),
        },
      };
    }
  }

  /**
   * Process plain text content
   */
  private processPlainText(text: string, url: string): ToolResult {
    const content = truncateText(text.trim(), MAX_CONTENT_LENGTH);

    return {
      success: true,
      data: {
        title: 'Plain Text',
        url,
        content,
        wordCount: countWords(content),
      },
    };
  }
}
