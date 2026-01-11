/**
 * System Prompt Builder Helper
 *
 * Centralizes the logic for building system prompts with all context:
 * - User memories
 * - Knowledge base entries
 * - Semantic message search
 * - Image retry context
 *
 * Used by both the AI plugin and the CLI prompt command.
 */

import { type BotConfig, buildSystemPrompt, getBotConfig, type Platform, type Tool } from '@core';
import {
  formatMemoriesForPrompt,
  getMemoriesForPrompt,
  getUserByPlatformId,
  type KnowledgeWithScore,
  type SimilarMessage,
  searchKnowledgeByEmbedding,
  searchSimilar,
} from '@core/database';
import { embed, isEmbedderReady } from '@core/embedder';

/** Number of semantic search results to include */
const SEMANTIC_LIMIT = 5;

/** Minimum similarity score to include in semantic results */
const SEMANTIC_THRESHOLD = 0.3;

/** Number of knowledge entries to inject */
const KNOWLEDGE_LIMIT = 5;

/** Minimum score for knowledge to be considered relevant */
const KNOWLEDGE_THRESHOLD = 0.35;

export interface PromptContext {
  /** The user's message content */
  messageContent: string;
  /** Platform (discord, slack, etc.) */
  platform: Platform;
  /** Guild/server ID (required for memories and knowledge) */
  guildId?: string;
  /** Channel ID (required for semantic message search) */
  channelId?: string;
  /** User's platform ID (required for memories) */
  userId?: string;
  /** User's display name (for formatting) */
  userName?: string;
  /** Available tools */
  tools?: Tool[];
  /** Additional context to append (e.g., image retry) */
  additionalContext?: string;
  /** Skip semantic message search */
  skipMessageSearch?: boolean;
  /** Skip knowledge base search */
  skipKnowledgeSearch?: boolean;
  /** Skip user memory lookup */
  skipMemories?: boolean;
}

export interface BuiltPrompt {
  /** The complete system prompt */
  systemPrompt: string;
  /** Individual context parts that were added */
  contextParts: string[];
  /** Debug info about what was loaded */
  debug: {
    memoriesCount: number;
    knowledgeCount: number;
    semanticResultsCount: number;
    topKnowledgeScore?: number;
    topSemanticScore?: number;
  };
}

/**
 * Build a complete system prompt with all relevant context
 */
export async function buildFullSystemPrompt(
  config: BotConfig | undefined,
  context: PromptContext,
): Promise<BuiltPrompt> {
  const resolvedConfig = config ?? getBotConfig();
  const contextParts: string[] = [];
  const debug = {
    memoriesCount: 0,
    knowledgeCount: 0,
    semanticResultsCount: 0,
    topKnowledgeScore: undefined as number | undefined,
    topSemanticScore: undefined as number | undefined,
  };

  // 1. Load user memories
  if (!context.skipMemories && context.guildId && context.userId) {
    try {
      const user = getUserByPlatformId(context.platform, context.userId);
      if (user) {
        const memories = await getMemoriesForPrompt({
          userId: user.id,
          guildId: context.guildId,
          currentMessage: context.messageContent,
          limit: 10,
        });

        if (memories.length > 0) {
          const userName = context.userName ?? 'User';
          contextParts.push(formatMemoriesForPrompt(memories, userName));
          debug.memoriesCount = memories.length;
        }
      }
    } catch (error) {
      console.error('Failed to load user memories:', error);
    }
  }

  // 2. Semantic search for messages AND knowledge (shares embedding)
  if (isEmbedderReady() && context.messageContent.length >= 10) {
    try {
      const queryEmbedding = await embed(context.messageContent);

      // Search relevant past messages
      if (!context.skipMessageSearch && context.channelId) {
        const similar = searchSimilar({
          embedding: queryEmbedding,
          channelId: context.channelId,
          limit: SEMANTIC_LIMIT,
          decayFactor: 0.98,
          includeBot: false,
        });

        const relevantResults = similar.filter((s) => s.score >= SEMANTIC_THRESHOLD);
        if (relevantResults.length > 0) {
          contextParts.push(formatSemanticResults(relevantResults));
          debug.semanticResultsCount = relevantResults.length;
          debug.topSemanticScore = relevantResults[0]?.score;
        }
      }

      // Search knowledge base (reusing same embedding)
      if (!context.skipKnowledgeSearch && context.guildId) {
        const knowledge = searchKnowledgeByEmbedding({
          guildId: context.guildId,
          embedding: queryEmbedding,
          limit: KNOWLEDGE_LIMIT,
          threshold: KNOWLEDGE_THRESHOLD,
        });

        if (knowledge.length > 0) {
          contextParts.push(formatKnowledgeResults(knowledge));
          debug.knowledgeCount = knowledge.length;
          debug.topKnowledgeScore = knowledge[0]?.score;
        }
      }
    } catch (error) {
      console.error('Semantic/knowledge search failed:', error);
    }
  }

  // 3. Add any additional context provided
  if (context.additionalContext) {
    contextParts.push(context.additionalContext);
  }

  // 4. Build final system prompt
  const systemPrompt = buildSystemPrompt(resolvedConfig, {
    platform: context.platform,
    tools: context.tools,
    additionalContext: contextParts.length > 0 ? contextParts.join('\n\n') : undefined,
  });

  return {
    systemPrompt,
    contextParts,
    debug,
  };
}

/**
 * Format semantic search results for injection into system prompt
 */
function formatSemanticResults(results: SimilarMessage[]): string {
  const lines = results.map((r) => {
    const age = formatAge(r.timestamp);
    return `- [${age}] @${r.userName}: "${r.content.substring(0, 150)}${r.content.length > 150 ? '...' : ''}"`;
  });

  return `# Relevant Past Messages
The following older messages may be relevant to this conversation:
${lines.join('\n')}`;
}

/**
 * Format knowledge base results for injection into system prompt
 */
function formatKnowledgeResults(results: KnowledgeWithScore[]): string {
  const lines = results.map((r) => {
    const tags = r.tags.length > 0 ? ` [${r.tags.join(', ')}]` : '';
    return `- ${r.content}${tags}`;
  });

  return `# Server Knowledge Base
The following information from this server's knowledge base may be relevant:
${lines.join('\n')}`;
}

/**
 * Format timestamp as human-readable age
 */
function formatAge(timestamp: number): string {
  const age = Date.now() - timestamp;
  const minutes = Math.floor(age / 60000);
  const hours = Math.floor(age / 3600000);
  const days = Math.floor(age / 86400000);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'just now';
}

// Re-export the formatting functions for use elsewhere
export { formatSemanticResults, formatKnowledgeResults, formatAge };
