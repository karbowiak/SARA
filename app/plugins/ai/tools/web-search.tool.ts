/**
 * Web Search Tool - Search the web for current information
 *
 * Supports both general and news-focused searches with time filtering.
 */

import type { Tool, ToolExecutionContext, ToolMetadata, ToolResult, ToolSchema } from '@core';
import { getBotConfig } from '@core';
import { fetcher } from '@core/helpers/fetcher';
import { z } from 'zod';

/**
 * Keywords that indicate a query is likely news-related.
 * Used for auto-detection when topic is not explicitly specified.
 */
const NEWS_INDICATORS = [
  'latest',
  'current',
  'today',
  'yesterday',
  'this week',
  'this month',
  'score',
  'scores',
  'price',
  'prices',
  'news',
  'won',
  'winning',
  'winner',
  'results',
  'update',
  'updates',
  'breaking',
  'recent',
  'just',
  'now',
  'stock',
  'market',
  'election',
  'match',
  'game',
  'vs',
  'versus',
];

/**
 * Detects if a query is likely news-related based on keyword patterns.
 * @param query - The search query to analyze
 * @returns true if the query appears to be news-related
 */
function isNewsQuery(query: string): boolean {
  const lowerQuery = query.toLowerCase();
  return NEWS_INDICATORS.some((indicator) => {
    // Match whole words or at word boundaries
    const regex = new RegExp(`\\b${indicator}\\b`, 'i');
    return regex.test(lowerQuery);
  });
}

export class WebSearchTool implements Tool {
  readonly metadata: ToolMetadata = {
    name: 'web_search',
    description: 'Search the web for current information, news, sports scores, or prices',
    version: '1.1.0',
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
      'score',
      'price',
      'stock',
    ],
    category: 'information',
    priority: 8,
  };

  readonly schema: ToolSchema = {
    type: 'function',
    name: 'web_search',
    description:
      'Search the web for current information, news, or facts. Use topic="news" for time-sensitive queries like sports scores, stock prices, or breaking news.',
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
        },
        topic: {
          type: 'string',
          enum: ['general', 'news'],
          description:
            'Search topic type. Use "news" for time-sensitive queries like current events, sports scores, stock prices. Default: auto-detected based on query.',
        },
        days: {
          type: 'number',
          description:
            'Limit results to the last N days (1-30). Only applies when topic is "news". Default: 3 for news queries.',
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
    topic: z.enum(['general', 'news']).optional(),
    days: z.number().int().min(1).max(30).optional(),
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

    // Determine topic: explicit param > auto-detection > default to general
    let topic: 'general' | 'news' = params.topic ?? 'general';
    let autoDetected = false;

    if (!params.topic && isNewsQuery(params.query)) {
      topic = 'news';
      autoDetected = true;
    }

    // Determine days filter (only applies to news topic)
    let days: number | undefined;
    if (topic === 'news') {
      // Use explicit days param, or default to 3 for auto-detected news queries
      days = params.days ?? (autoDetected ? 3 : undefined);
    }

    context.logger.info('WebSearchTool executing', {
      query: params.query,
      maxResults,
      topic,
      days,
      autoDetected,
    });

    try {
      // Build request body
      const requestBody: Record<string, unknown> = {
        api_key: this.apiKey,
        query: params.query,
        max_results: maxResults,
        search_depth: 'basic',
        include_answer: true,
        topic,
      };

      // Only include days for news topic (Tavily API constraint)
      if (topic === 'news' && days !== undefined) {
        requestBody.days = days;
      }

      const response = await fetcher('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        throw new Error(`Search API error: ${response.status}`);
      }

      const data = (await response.json()) as {
        answer?: string;
        results: Array<{
          title: string;
          url: string;
          content: string;
          score: number;
          published_date?: string;
        }>;
      };

      // Build search context note
      let searchContext = `Search type: ${topic}`;
      if (topic === 'news') {
        searchContext += days ? ` (last ${days} days)` : ' (recent)';
      }
      if (autoDetected) {
        searchContext += ' [auto-detected]';
      }

      return {
        success: true,
        data: {
          query: params.query,
          searchContext,
          answer: data.answer,
          results: data.results.map((r, i) => ({
            position: i + 1,
            title: r.title,
            url: r.url,
            snippet: r.content,
            ...(r.published_date && { publishedDate: r.published_date }),
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
