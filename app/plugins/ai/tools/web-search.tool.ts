/**
 * Web Search Tool - Search the web for current information
 *
 * Example AI tool implementation.
 */

import type { Tool, ToolExecutionContext, ToolMetadata, ToolResult, ToolSchema } from '@core';
import { getBotConfig } from '@core';
import { fetcher } from '@core/helpers/fetcher';
import { z } from 'zod';

export class WebSearchTool implements Tool {
  readonly metadata: ToolMetadata = {
    name: 'web_search',
    description: 'Search the web for current information',
    version: '1.0.0',
    author: 'Bot',
    keywords: [
      'search',
      'google',
      'find',
      'look up',
      'web',
      'internet',
      'current',
      'latest',
      'news',
      'recent',
      'today',
      'what is',
      'who is',
      'where is',
      'when is',
      'how to',
    ],
    category: 'information',
    priority: 8,
  };

  readonly schema: ToolSchema = {
    type: 'function',
    name: 'web_search',
    description: 'Search the web for current information, news, or facts.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query to execute',
        },
        max_results: {
          type: 'number',
          description: 'Maximum number of results to return (1-10, default 5)',
          minimum: 1,
          maximum: 10,
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
    strict: true,
  };

  private apiKey?: string;

  constructor(apiKey?: string) {
    // Try config first, then constructor arg, then env var
    try {
      const config = getBotConfig();
      this.apiKey = config.tokens.tavily;
    } catch {
      // Config not loaded yet, use fallback
    }
    this.apiKey = this.apiKey ?? apiKey ?? process.env.TAVILY_API_KEY;
  }

  validate(): boolean {
    return !!this.apiKey;
  }

  // Zod schema for input validation
  private readonly argsSchema = z.object({
    query: z.string().min(1).max(1000),
    max_results: z.number().int().min(1).max(10).optional(),
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

    if (!this.apiKey) {
      return {
        success: false,
        error: {
          type: 'configuration_error',
          message: 'Search API key not configured',
        },
      };
    }

    const params = parseResult.data;
    const maxResults = Math.min(Math.max(params.max_results ?? 5, 1), 10);

    context.logger.info('WebSearchTool executing', { query: params.query, maxResults });

    try {
      const response = await fetcher('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: this.apiKey,
          query: params.query,
          max_results: maxResults,
          search_depth: 'basic',
          include_answer: true,
        }),
      });

      if (!response.ok) {
        throw new Error(`Search API error: ${response.status}`);
      }

      const data = (await response.json()) as {
        results: Array<{ title: string; url: string; content: string; score: number }>;
      };

      return {
        success: true,
        data: {
          query: params.query,
          results: data.results.map((r, i) => ({
            position: i + 1,
            title: r.title,
            url: r.url,
            snippet: r.content,
          })),
        },
      };
    } catch (error) {
      context.logger.error('WebSearchTool failed', {
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        success: false,
        error: {
          type: 'execution_error',
          message: error instanceof Error ? error.message : String(error),
          retryable: true,
        },
      };
    }
  }
}
