/**
 * Last Seen Tool - Check when a user was last active
 *
 * Allows the AI to look up when users were last seen and their activity stats.
 * Can search by username or look up specific users.
 */

import type { Tool, ToolExecutionContext, ToolMetadata, ToolResult, ToolSchema } from '@core';
import { getRecentUsers, getUserByPlatformId, type StoredUser, searchUsers } from '@core/database';
import { z } from 'zod';

export class LastSeenTool implements Tool {
  readonly metadata: ToolMetadata = {
    name: 'last_seen',
    description: 'Check when a user was last seen or find recently active users',
    version: '1.0.0',
    author: 'system',
    keywords: ['seen', 'active', 'online', 'activity', 'user', 'last'],
    category: 'information',
    priority: 5,
  };

  readonly schema: ToolSchema = {
    type: 'function',
    name: 'last_seen',
    description: `Look up user activity information. Use this to:
- Check when a specific user was last active
- Search for users by username
- Get a list of recently active users

Returns timestamps for last seen and last message, plus message count.`,
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['lookup', 'search', 'recent'],
          description: 'Action: lookup=specific user by mention, search=find by username, recent=list recent users',
        },
        query: {
          type: 'string',
          description: 'Username to search for (for search action) or user ID (for lookup)',
        },
        limit: {
          type: 'number',
          description: 'Max results to return (default: 5, max: 20)',
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
    strict: true,
  };

  // Zod schema for input validation
  private readonly argsSchema = z.object({
    action: z.enum(['lookup', 'search', 'recent']),
    query: z.string().max(500).optional(),
    limit: z.number().int().min(1).max(20).optional(),
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

    const limit = Math.min(Math.max(params.limit || 5, 1), 20);

    switch (params.action) {
      case 'lookup':
        return this.lookupUser(params.query, context);
      case 'search':
        return this.searchUsers(params.query, limit);
      case 'recent':
        return this.getRecentUsers(limit);
      default:
        return {
          success: false,
          error: {
            type: 'invalid_action',
            message: `Unknown action: ${params.action}`,
          },
        };
    }
  }

  private lookupUser(query: string | undefined, context: ToolExecutionContext): ToolResult {
    if (!query) {
      return {
        success: false,
        error: {
          type: 'missing_query',
          message: 'User ID or username is required for lookup',
        },
      };
    }

    // Try to find by platform user ID first (for mentions)
    const platform = context.message.platform;
    let user: StoredUser | null = getUserByPlatformId(platform, query);

    // If not found, try searching
    if (!user) {
      const results = searchUsers(query, 1);
      if (results.length > 0) {
        user = results[0] ?? null;
      }
    }

    if (!user) {
      return {
        success: true,
        data: {
          found: false,
          message: `No user found matching "${query}"`,
        },
      };
    }

    return {
      success: true,
      data: {
        found: true,
        user: this.formatUser(user),
      },
    };
  }

  private searchUsers(query: string | undefined, limit: number): ToolResult {
    if (!query) {
      return {
        success: false,
        error: {
          type: 'missing_query',
          message: 'Search query is required',
        },
      };
    }

    const results = searchUsers(query, limit);

    if (results.length === 0) {
      return {
        success: true,
        data: {
          count: 0,
          message: `No users found matching "${query}"`,
          users: [],
        },
      };
    }

    return {
      success: true,
      data: {
        count: results.length,
        users: results.map((u) => this.formatUser(u)),
      },
    };
  }

  private getRecentUsers(limit: number): ToolResult {
    const results = getRecentUsers(limit);

    return {
      success: true,
      data: {
        count: results.length,
        users: results.map((u) => this.formatUser(u)),
      },
    };
  }

  private formatUser(user: StoredUser): object {
    const now = Date.now();
    const lastSeenAgo = this.formatTimeAgo(now - user.last_seen_at);
    const lastMessageAgo = user.last_message_at ? this.formatTimeAgo(now - user.last_message_at) : null;

    return {
      username: user.username,
      displayName: user.display_name || user.username,
      lastSeen: new Date(user.last_seen_at).toISOString(),
      lastSeenAgo,
      lastMessage: user.last_message_at ? new Date(user.last_message_at).toISOString() : null,
      lastMessageAgo,
      messageCount: user.message_count,
      firstSeen: new Date(user.first_seen_at).toISOString(),
      isBot: user.is_bot === 1,
    };
  }

  private formatTimeAgo(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days} day${days !== 1 ? 's' : ''} ago`;
    if (hours > 0) return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
    if (minutes > 0) return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
    return 'just now';
  }
}
