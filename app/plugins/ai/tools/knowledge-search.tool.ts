/**
 * Knowledge Search Tool
 *
 * Search the guild's knowledge base using semantic search.
 * Knowledge is shared across the entire guild (not user-specific like memories).
 */

import type { Tool, ToolExecutionContext, ToolMetadata, ToolResult, ToolSchema } from '@core';
import { getKnowledge, getKnowledgeTags, searchKnowledge } from '@core/database';

export class KnowledgeSearchTool implements Tool {
  readonly metadata: ToolMetadata = {
    name: 'search_knowledge',
    description: 'Search the server knowledge base for information',
    version: '1.0.0',
    author: 'system',
    keywords: ['knowledge', 'search', 'wiki', 'info', 'documentation'],
    category: 'information',
    priority: 6,
  };

  readonly schema: ToolSchema = {
    type: 'function',
    name: 'search_knowledge',
    description: `Search the server's knowledge base for relevant information. The knowledge base contains shared information, documentation, FAQs, and other resources added by server members. Use this when the user asks about server-specific information, rules, documentation, or when you need to find factual information that might be stored in the knowledge base.`,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query - describe what information you are looking for',
        },
        tag: {
          type: 'string',
          description: 'Optional tag to filter results (e.g., "rules", "faq", "guide")',
        },
        id: {
          type: 'number',
          description: 'Optional: Get a specific knowledge entry by ID instead of searching',
        },
        list_tags: {
          type: 'boolean',
          description: 'If true, returns all available tags in this server instead of searching',
        },
      },
      required: [],
      additionalProperties: false,
    },
    strict: true,
  };

  async execute(args: unknown, context: ToolExecutionContext): Promise<ToolResult> {
    const params = args as {
      query?: string;
      tag?: string;
      id?: number;
      list_tags?: boolean;
    };

    const guildId = context.message.guildId;
    if (!guildId) {
      return {
        success: false,
        error: {
          type: 'context_error',
          message: 'Knowledge base is only available in servers, not DMs',
        },
      };
    }

    try {
      // List tags mode
      if (params.list_tags) {
        const tags = getKnowledgeTags(guildId);
        return {
          success: true,
          data: {
            tags,
            count: tags.length,
            hint: tags.length === 0 ? 'No knowledge entries exist yet' : 'Use these tags to filter searches',
          },
        };
      }

      // Get by ID mode
      if (params.id !== undefined) {
        const entry = getKnowledge(params.id);
        if (!entry) {
          return {
            success: false,
            error: {
              type: 'not_found',
              message: `Knowledge entry #${params.id} not found`,
            },
          };
        }

        // Verify it belongs to this guild
        if (entry.guild_id !== guildId) {
          return {
            success: false,
            error: {
              type: 'not_found',
              message: `Knowledge entry #${params.id} not found in this server`,
            },
          };
        }

        return {
          success: true,
          data: {
            id: entry.id,
            content: entry.content,
            tags: entry.tags,
            created: new Date(entry.created_at).toISOString(),
          },
        };
      }

      // Search mode (requires query)
      if (!params.query) {
        return {
          success: false,
          error: {
            type: 'validation_error',
            message: 'Please provide a search query, an ID, or set list_tags to true',
          },
        };
      }

      const results = await searchKnowledge({
        guildId,
        query: params.query,
        tag: params.tag,
        limit: 5,
      });

      if (results.length === 0) {
        return {
          success: true,
          data: {
            results: [],
            message: params.tag
              ? `No knowledge found matching "${params.query}" with tag "${params.tag}"`
              : `No knowledge found matching "${params.query}"`,
            hint: 'The knowledge base may not have information on this topic yet',
          },
        };
      }

      return {
        success: true,
        data: {
          results: results.map((r) => ({
            id: r.id,
            content: r.content,
            tags: r.tags,
            relevance: `${Math.round(r.score * 100)}%`,
          })),
          count: results.length,
        },
      };
    } catch (error) {
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
