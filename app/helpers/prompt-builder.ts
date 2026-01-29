/**
 * System Prompt Builder Helper
 *
 * Centralizes the logic for building system prompts with all context:
 * - User profiles (high-level overview of the user)
 * - User memories (specific remembered facts)
 * - Knowledge base entries
 * - Semantic message search
 * - Image retry context
 *
 * Used by both the AI plugin and the CLI prompt command.
 */

import { type BotConfig, buildSystemPrompt, getBotConfig, type Platform, type Tool } from '@core';
import {
  formatMemoriesForPrompt,
  formatProfileForPrompt,
  getMemoriesForPrompt,
  getOptOutStatus,
  getProfile,
  getRecentMessages,
  getUserByPlatformId,
  type KnowledgeWithScore,
  type SimilarMessage,
  searchKnowledgeByEmbedding,
  searchSimilar,
} from '@core/database';
import { embed, isEmbedderReady } from '@core/embedder';

/** Number of semantic search results to include */
const SEMANTIC_LIMIT = 3;

/** Minimum similarity score to include in semantic results (raised to reduce noise) */
const SEMANTIC_THRESHOLD = 0.6;

/** Number of knowledge entries to inject */
const KNOWLEDGE_LIMIT = 3;

/** Minimum score for knowledge to be considered relevant (lower than semantic to catch conversational queries) */
const KNOWLEDGE_THRESHOLD = 0.35;

/** Skip semantic search if there are this many recent messages (they're already in history) */
const SKIP_SEMANTIC_IF_RECENT_MESSAGES = 5;

export interface PromptContext {
  /** The user's message content */
  messageContent: string;
  /** Platform (discord, slack, etc.) */
  platform: Platform;
  /** Guild/server ID (required for memories and knowledge) */
  guildId?: string;
  /** Channel ID (required for semantic message search) */
  channelId?: string;
  /** Channel name (for context) */
  channelName?: string;
  /** Channel topic/description set by admins */
  channelTopic?: string;
  /** User's platform ID (required for memories) */
  userId?: string;
  /** User's display name (for formatting) */
  userName?: string;
  /** Available tools */
  tools?: Tool[];
  /** Additional context to append (e.g., image retry) */
  additionalContext?: string;
  /** Pre-formatted channel history to inject into system prompt */
  channelHistory?: string;
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
    profileLoaded: boolean;
    memoriesCount: number;
    knowledgeCount: number;
    semanticResultsCount: number;
    historyCount: number;
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
    profileLoaded: false,
    memoriesCount: 0,
    knowledgeCount: 0,
    semanticResultsCount: 0,
    historyCount: 0,
    topKnowledgeScore: undefined as number | undefined,
    topSemanticScore: undefined as number | undefined,
  };

  // Resolve user once for both profile and memories
  const user = context.guildId && context.userId ? getUserByPlatformId(context.platform, context.userId) : null;

  // 1. Load user profile (before memories for better context ordering)
  if (context.guildId && user) {
    try {
      const optedOut = getOptOutStatus(user.id, context.guildId);
      if (!optedOut) {
        const profile = getProfile(user.id, context.guildId);
        if (profile) {
          const formattedProfile = formatProfileForPrompt(profile, context.userName ?? 'User');
          if (formattedProfile) {
            contextParts.push(formattedProfile);
            debug.profileLoaded = true;
          }
        }
      }
    } catch (error) {
      console.error('Failed to load user profile:', error);
    }
  }

  // 2. Load user memories
  if (!context.skipMemories && context.guildId && user) {
    try {
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
    } catch (error) {
      console.error('Failed to load user memories:', error);
    }
  }

  // 3. Semantic search for messages AND knowledge (shares embedding)
  if (isEmbedderReady() && context.messageContent.length >= 10) {
    try {
      const queryEmbedding = await embed(context.messageContent);

      // Search relevant past messages (skip if there's enough recent history already)
      if (!context.skipMessageSearch && context.channelId) {
        // Check if we have enough recent messages - if so, skip semantic search
        // (those messages are already in conversation history)
        const recentMessages = getRecentMessages(context.channelId, SKIP_SEMANTIC_IF_RECENT_MESSAGES + 1);
        const recentCount = recentMessages.filter(
          (m) => Date.now() - m.created_at < 30 * 60 * 1000, // Last 30 minutes
        ).length;

        if (recentCount < SKIP_SEMANTIC_IF_RECENT_MESSAGES) {
          const similar = searchSimilar({
            embedding: queryEmbedding,
            channelId: context.channelId,
            limit: SEMANTIC_LIMIT + 5, // Fetch extra to account for deduplication
            decayFactor: 0.98,
            includeBot: false,
          });

          // Deduplicate: exclude messages that are already in recent history
          const recentMessageIds = new Set(recentMessages.map((m) => m.id));
          const deduped = similar.filter((s) => !recentMessageIds.has(s.id));

          const relevantResults = deduped.filter((s) => s.score >= SEMANTIC_THRESHOLD).slice(0, SEMANTIC_LIMIT);
          if (relevantResults.length > 0) {
            contextParts.push(formatSemanticResults(relevantResults));
            debug.semanticResultsCount = relevantResults.length;
            debug.topSemanticScore = relevantResults[0]?.score;
          }
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

  // 4. Add channel context if we have name or topic
  if (context.channelName || context.channelTopic) {
    let channelSection = '# Channel Context';
    if (context.channelName) {
      channelSection += `\n- Channel: #${context.channelName}`;
    }
    if (context.channelTopic) {
      channelSection += `\n- Topic: ${context.channelTopic}`;
    }
    contextParts.push(channelSection);
  }

  // 5. Inject channel history as context (NOT as separate LLM turns)
  if (context.channelHistory) {
    const historySection = `# Recent Channel Context
The following messages are recent conversation history for reference. Respond ONLY to the current user message below.

${context.channelHistory}`;
    contextParts.push(historySection);
    // Count lines that start with "- " as messages
    debug.historyCount = (context.channelHistory.match(/^- /gm) || []).length;
  }

  // 6. Add any additional context provided
  if (context.additionalContext) {
    contextParts.push(context.additionalContext);
  }

  // 6b. Encourage tools for extra context instead of guessing
  if (context.tools && context.tools.length > 0) {
    const toolNames = new Set(context.tools.map((t) => t.metadata.name));
    const guidanceLines: string[] = [];
    if (toolNames.has('channel_history')) {
      guidanceLines.push('- Use channel_history for prior messages instead of guessing.');
    }
    if (toolNames.has('search_knowledge')) {
      guidanceLines.push('- Use search_knowledge for server-specific info instead of guessing.');
    }
    if (guidanceLines.length > 0) {
      contextParts.push(`# Tool Guidance\n${guidanceLines.join('\n')}`);
    }
  }

  // 7. Build final system prompt
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
    return `- @${r.userName}: "${r.content.substring(0, 150)}${r.content.length > 150 ? '...' : ''}"`;
  });

  return `# Relevant Past Messages
The following older messages may be relevant to this conversation:
${lines.join('\n')}`;
}

/**
 * Format knowledge base results for injection into system prompt
 * Long entries are truncated with a hint to use the search_knowledge tool
 */
function formatKnowledgeResults(results: KnowledgeWithScore[]): string {
  const MAX_CONTENT_LENGTH = 500;

  const lines = results.map((r) => {
    const tags = r.tags.length > 0 ? ` [${r.tags.join(', ')}]` : '';
    const isTruncated = r.content.length > MAX_CONTENT_LENGTH;
    const content = isTruncated
      ? `${r.content.substring(0, MAX_CONTENT_LENGTH)}... [truncated, use search_knowledge tool for full content]`
      : r.content;
    return `- ${content}${tags}`;
  });

  return `# Server Knowledge Base
The following information from this server's knowledge base may be relevant:
${lines.join('\n')}`;
}

/**
 * Format timestamp as human-readable age
 * @param timestamp - Unix timestamp in milliseconds
 * @param short - Use short format (3d ago) vs long format (3 days ago)
 */
function formatAge(timestamp: number, short = true): string {
  const age = Date.now() - timestamp;
  const minutes = Math.floor(age / 60000);
  const hours = Math.floor(age / 3600000);
  const days = Math.floor(age / 86400000);

  if (short) {
    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'just now';
  } else {
    if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
    if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    return 'just now';
  }
}

// Re-export the formatting functions for use elsewhere
export { formatSemanticResults, formatKnowledgeResults, formatAge };
