/**
 * Memory Tool - Save and recall user memories/preferences
 *
 * Allows the AI to:
 * 1. Save memories about users (preferences, facts, instructions, context)
 * 2. Recall specific memories via semantic search
 * 3. Forget memories when requested
 */

import type { Tool, ToolExecutionContext, ToolMetadata, ToolResult, ToolSchema } from '@core';
import {
  deleteMemory,
  getMemories,
  getUserByPlatformId,
  isGlobalMemoryEnabled,
  type MemoryType,
  saveMemory,
  searchMemories,
  updateMemory,
} from '@core/database';
import { z } from 'zod';

export class MemoryTool implements Tool {
  readonly metadata: ToolMetadata = {
    name: 'memory',
    description:
      'Remember important information about users. You SHOULD proactively use this when users share facts, preferences, or ongoing context.',
    version: '2.0.0',
    author: 'system',
    keywords: ['remember', 'memory', 'save', 'recall', 'forget', 'preference', 'fact'],
    category: 'utility',
    priority: 9,
  };

  readonly schema: ToolSchema = {
    type: 'function',
    name: 'memory',
    description: `Manage user memories. You SHOULD proactively use this when users share information worth remembering.

Memory scope:
- By default, memories are stored per-server
- Users can enable global memory scope with /config scope global
- With global scope enabled, memories work in DMs and are shared across all servers

When to AUTO-SAVE (use source="inferred"):
- User mentions their job, workplace, or profession
- User shares location, timezone, or hometown
- User mentions preferences (likes, dislikes, communication style)
- User discusses ongoing projects, hobbies, or interests
- Context that should persist across conversations (e.g., "Working on Rust project")

When to EXPLICITLY REMEMBER (use source="explicit"):
- User directly asks you to remember something
- User says "remember that..." or similar phrases
- Critical information the user explicitly emphasizes

Memory limits:
- Auto-saved (inferred): Max 100 per user per scope, oldest auto-removed when limit reached
- User-saved (explicit): Max 100 per user per scope, user must manage

Memory types:
- "preference": How the user wants to be treated (e.g., "Call me Dave", "Use formal language")
- "fact": Information about the user (e.g., "Works at Google", "Lives in Copenhagen")
- "instruction": Persistent behavior rules (e.g., "Always respond in Danish")
- "context": Ongoing topics/projects (e.g., "Working on a Rust project")
- "profile_update": Flag that the user's profile needs updating (e.g., "User said they moved to Berlin - update facts")

Use 'profile_update' when you notice information that contradicts or should update the user's profile. 
These are processed during profile regeneration. Example: if a user says "I just moved to Berlin" but 
their profile says "Lives in Copenhagen", save a profile_update memory noting the change.`,
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['save', 'recall', 'forget', 'update'],
          description:
            'The action to perform: save (create new), recall (search), forget (delete), update (modify existing by ID)',
        },
        type: {
          type: 'string',
          enum: ['preference', 'fact', 'instruction', 'context', 'profile_update'],
          description: 'Type of memory (required for save)',
        },
        content: {
          type: 'string',
          description: 'The memory content to save, or search query for recall',
        },
        memory_id: {
          type: 'number',
          description: 'Memory ID (required for forget and update actions)',
        },
        source: {
          type: 'string',
          enum: ['explicit', 'inferred'],
          description:
            'Use "explicit" when user directly asks to remember, "inferred" when you proactively notice important information',
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
    strict: true,
  };

  // Zod schema for input validation
  private readonly argsSchema = z.object({
    action: z.enum(['save', 'recall', 'forget', 'update']),
    type: z.enum(['preference', 'fact', 'instruction', 'context', 'profile_update']).optional(),
    content: z.string().max(5000).optional(),
    memory_id: z.number().int().positive().optional(),
    source: z.enum(['explicit', 'inferred']).optional(),
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

    // Get user's internal ID
    const user = getUserByPlatformId(context.message.platform, context.user.id);

    if (!user) {
      return {
        success: false,
        error: {
          type: 'user_not_found',
          message: 'User not found in database. They need to send at least one message first.',
        },
      };
    }

    const guildId = context.message.guildId;
    const isGlobal = isGlobalMemoryEnabled(user.id);

    // Allow DMs only if user has global memory scope enabled
    if (!guildId && !isGlobal) {
      return {
        success: false,
        error: {
          type: 'no_guild',
          message: 'Memories in DMs require global memory scope. Enable it with /config scope global',
        },
      };
    }

    // Determine effective guildId: use 'dm' for DM context with global scope
    const effectiveGuildId = guildId ?? 'dm';

    switch (params.action) {
      case 'save':
        return this.saveMemory(user.id, effectiveGuildId, params, context, isGlobal);
      case 'recall':
        return this.recallMemory(user.id, effectiveGuildId, params.content, context, isGlobal);
      case 'forget':
        return this.forgetMemory(params.memory_id, context);
      case 'update':
        return this.updateMemory(params.memory_id, params.content, context);
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

  private async saveMemory(
    userId: number,
    guildId: string,
    params: { type?: MemoryType; content?: string; source?: 'explicit' | 'inferred' },
    context: ToolExecutionContext,
    isGlobal: boolean = false,
  ): Promise<ToolResult> {
    if (!params.type) {
      return {
        success: false,
        error: {
          type: 'missing_type',
          message: 'Memory type is required for save action',
        },
      };
    }

    if (!params.content) {
      return {
        success: false,
        error: {
          type: 'missing_content',
          message: 'Memory content is required for save action',
        },
      };
    }

    try {
      const result = await saveMemory({
        userId,
        guildId,
        type: params.type,
        content: params.content,
        source: params.source ?? 'explicit',
        isGlobal,
      });

      context.logger.info('Memory saved', {
        userId,
        guildId,
        type: params.type,
        memoryId: result.id,
        updated: result.updated,
      });

      return {
        success: true,
        data: {
          id: result.id,
          action: result.updated ? 'updated' : 'created',
          message: result.updated
            ? `Updated existing memory (ID: ${result.id})`
            : `Saved new memory (ID: ${result.id})`,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: {
          type: 'save_error',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  private async recallMemory(
    userId: number,
    guildId: string,
    query: string | undefined,
    _context: ToolExecutionContext,
    isGlobal: boolean = false,
  ): Promise<ToolResult> {
    try {
      // For global scope, pass null to get global memories; otherwise use guildId
      const effectiveGuildId = isGlobal ? null : guildId;

      if (query) {
        // Semantic search
        const results = await searchMemories({
          userId,
          guildId: effectiveGuildId,
          query,
          limit: 5,
        });

        return {
          success: true,
          data: {
            memories: results.map((m) => ({
              id: m.id,
              type: m.type,
              content: m.content,
              relevance: m.score.toFixed(2),
            })),
            count: results.length,
          },
        };
      } else {
        // Return all memories
        const memories = getMemories(userId, effectiveGuildId);

        return {
          success: true,
          data: {
            memories: memories.map((m) => ({
              id: m.id,
              type: m.type,
              content: m.content,
              source: m.source,
            })),
            count: memories.length,
          },
        };
      }
    } catch (error) {
      return {
        success: false,
        error: {
          type: 'recall_error',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  private async forgetMemory(memoryId: number | undefined, context: ToolExecutionContext): Promise<ToolResult> {
    if (memoryId === undefined) {
      return {
        success: false,
        error: {
          type: 'missing_id',
          message: 'Memory ID is required for forget action',
        },
      };
    }

    try {
      const deleted = deleteMemory(memoryId);

      if (deleted) {
        context.logger.info('Memory deleted', { memoryId });
        return {
          success: true,
          data: {
            message: `Memory ${memoryId} has been forgotten`,
          },
        };
      } else {
        return {
          success: false,
          error: {
            type: 'not_found',
            message: `Memory ${memoryId} not found`,
          },
        };
      }
    } catch (error) {
      return {
        success: false,
        error: {
          type: 'forget_error',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  private async updateMemory(
    memoryId: number | undefined,
    content: string | undefined,
    context: ToolExecutionContext,
  ): Promise<ToolResult> {
    if (memoryId === undefined) {
      return {
        success: false,
        error: {
          type: 'missing_id',
          message: 'Memory ID is required for update action',
        },
      };
    }

    if (!content) {
      return {
        success: false,
        error: {
          type: 'missing_content',
          message: 'Content is required for update action',
        },
      };
    }

    try {
      const updated = await updateMemory(memoryId, content);

      if (updated) {
        context.logger.info('Memory updated', { memoryId });
        return {
          success: true,
          data: {
            message: `Memory ${memoryId} has been updated`,
            memory_id: memoryId,
          },
        };
      } else {
        return {
          success: false,
          error: {
            type: 'not_found',
            message: `Memory ${memoryId} not found`,
          },
        };
      }
    } catch (error) {
      return {
        success: false,
        error: {
          type: 'update_error',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }
}
