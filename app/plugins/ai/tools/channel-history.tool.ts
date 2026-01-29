/**
 * Channel History Tool - Search and retrieve channel message history
 *
 * Allows the AI to:
 * 1. Get recent messages from the channel (for more context)
 * 2. Search for relevant messages using semantic search
 */

import { formatAge } from '@app/helpers/prompt-builder';
import type { Tool, ToolExecutionContext, ToolMetadata, ToolResult, ToolSchema } from '@core';
import { getRecentMessages, type SimilarMessage, type StoredMessage, searchSimilar } from '@core/database';
import { embed, isEmbedderReady } from '@core/embedder';
import { z } from 'zod';

export class ChannelHistoryTool implements Tool {
  readonly metadata: ToolMetadata = {
    name: 'channel_history',
    description:
      'Search or retrieve message history from the current channel. Use "recent" mode to get the last N messages, or "search" mode to find messages matching a query.',
    version: '1.0.0',
    author: 'system',
    keywords: ['history', 'messages', 'search', 'context', 'past', 'previous'],
    category: 'information',
    priority: 10,
  };

  readonly schema: ToolSchema = {
    type: 'function',
    name: 'channel_history',
    description:
      'Search or retrieve message history from the current channel. Use "recent" mode to get the last N messages for more conversation context, or "search" mode to find specific messages matching a search query.',
    parameters: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['recent', 'search'],
          description: 'Mode of retrieval: "recent" for last N messages, "search" for semantic search',
        },
        query: {
          type: 'string',
          description: 'Search query (required for "search" mode). Describe what you\'re looking for.',
        },
        limit: {
          type: 'number',
          description: 'Number of messages to retrieve. Default: 50 for recent, 10 for search. Max: 100.',
        },
      },
      required: ['mode'],
      additionalProperties: false,
    },
    strict: true,
  };

  validate(): boolean {
    return true; // Always available
  }

  // Zod schema for input validation
  private readonly argsSchema = z.object({
    mode: z.enum(['recent', 'search']),
    query: z.string().min(3).max(1000).optional(),
    limit: z.number().int().min(1).max(100).optional(),
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

    const params = parseResult.data;

    const { mode, query, limit: requestedLimit } = params;
    const channelId = context.channel.id;

    if (mode === 'search') {
      return this.executeSearch(query, channelId, requestedLimit, context);
    } else {
      return this.executeRecent(channelId, requestedLimit, context);
    }
  }

  /**
   * Get recent messages from the channel
   */
  private async executeRecent(
    channelId: string,
    requestedLimit: number | undefined,
    context: ToolExecutionContext,
  ): Promise<ToolResult> {
    const limit = Math.min(requestedLimit ?? 50, 100);

    try {
      const messages = getRecentMessages(channelId, limit);

      if (messages.length === 0) {
        return {
          success: true,
          data: {
            mode: 'recent',
            count: 0,
            messages: [],
            note: 'No messages found in this channel yet.',
          },
        };
      }

      // Format messages for AI consumption (oldest first)
      const formatted = messages.reverse().map((m: StoredMessage) => ({
        timestamp: new Date(m.created_at).toISOString(),
        user: m.username ?? 'Unknown',
        isBot: Boolean(m.is_bot),
        content: m.content,
      }));

      context.logger.info('ChannelHistoryTool: Retrieved recent messages', {
        channelId,
        count: formatted.length,
      });

      return {
        success: true,
        data: {
          mode: 'recent',
          count: formatted.length,
          messages: formatted,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: {
          type: 'execution_error',
          message: `Failed to retrieve messages: ${error instanceof Error ? error.message : String(error)}`,
          retryable: true,
        },
      };
    }
  }

  /**
   * Search for messages using semantic search
   */
  private async executeSearch(
    query: string | undefined,
    channelId: string,
    requestedLimit: number | undefined,
    context: ToolExecutionContext,
  ): Promise<ToolResult> {
    if (!query || query.trim().length < 3) {
      return {
        success: false,
        error: {
          type: 'invalid_parameters',
          message: 'Search query must be at least 3 characters',
          retryable: false,
        },
      };
    }

    if (!isEmbedderReady()) {
      return {
        success: false,
        error: {
          type: 'configuration_error',
          message: 'Embedding model not ready. Try using "recent" mode instead.',
          retryable: true,
        },
      };
    }

    const limit = Math.min(requestedLimit ?? 10, 50);

    try {
      // Generate embedding for the search query
      const queryEmbedding = await embed(query);

      // Search for similar messages
      const results = searchSimilar({
        embedding: queryEmbedding,
        channelId,
        limit,
        decayFactor: 0.98,
        includeBot: false,
      });

      if (results.length === 0) {
        return {
          success: true,
          data: {
            mode: 'search',
            query,
            count: 0,
            messages: [],
            note: 'No relevant messages found matching your query.',
          },
        };
      }

      // Format results with relevance info
      const formatted = results.map((r: SimilarMessage) => ({
        timestamp: new Date(r.timestamp).toISOString(),
        age: formatAge(r.timestamp, false),
        user: r.userName,
        content: r.content,
        relevance: `${Math.round(r.score * 100)}%`,
      }));

      context.logger.info('ChannelHistoryTool: Search completed', {
        channelId,
        query,
        resultCount: formatted.length,
        topScore: results[0]?.score,
      });

      return {
        success: true,
        data: {
          mode: 'search',
          query,
          count: formatted.length,
          messages: formatted,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: {
          type: 'execution_error',
          message: `Search failed: ${error instanceof Error ? error.message : String(error)}`,
          retryable: true,
        },
      };
    }
  }
}
