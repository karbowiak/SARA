/**
 * Prompt Command - Preview the generated system prompt or simulate a query
 *
 * Usage:
 *   bun cli prompt                           - Show system prompt
 *   bun cli prompt "what is love?"          - Simulate a query with full context
 *   bun cli prompt --platform=slack         - Show prompt for specific platform
 *   bun cli prompt --tools                  - Include tool descriptions
 *   bun cli prompt --full                   - Show full message array sent to the LLM
 */

import { Command, loadBotConfig, type Platform, type Tool } from '@core';
import { getRecentMessages, initDatabase } from '@core/database';
import { initEmbedder } from '@core/embedder';
import { buildFullSystemPrompt } from '../helpers/prompt-builder';

// Default channel for testing (your Discord channel)
const DEFAULT_GUILD_ID = '442642549971353621';
const DEFAULT_CHANNEL_ID = '1214874823063502898';
const DEFAULT_USER_ID = '123456789';
const HISTORY_LIMIT = 5;

export default class PromptCommand extends Command {
  static override signature = `
    prompt
    {query? : Optional query to simulate (e.g., "what is love?")}
    {--c|config=config/config.ts : Path to config file}
    {--platform=discord : Platform to generate for (discord, slack)}
    {--tools : Include placeholder tool descriptions}
    {--channel= : Override channel ID}
    {--guild= : Override guild ID}
    {--user= : Override user ID (for memory lookup)}
    {--username= : Override user display name}
    {--skip-memories : Skip user memory lookup}
    {--with-knowledge : Include knowledge base search}
    {--with-messages : Include semantic message search}
    {--full : Print the full LLM messages array}
  `;
  static override description = 'Preview the generated system prompt or simulate a query with context';

  async handle(): Promise<number> {
    const query = this.argument('query') as string | undefined;
    const configPath = this.option('config') as string;
    const platform = ((this.option('platform') as string) ?? 'discord') as Platform;
    const includeTools = this.option('tools') as boolean;
    const channelId = (this.option('channel') as string) || DEFAULT_CHANNEL_ID;
    const guildId = (this.option('guild') as string) || DEFAULT_GUILD_ID;
    const userId = (this.option('user') as string) || DEFAULT_USER_ID;
    const userName = (this.option('username') as string) || 'TestUser';
    const skipMemories = this.option('skip-memories') as boolean;
    const includeKnowledge = this.option('with-knowledge') as boolean;
    const includeMessages = this.option('with-messages') as boolean;
    const showFull = this.option('full') as boolean;

    // Initialize database and embedder
    initDatabase();

    if (query && query.length >= 3) {
      this.info('Initializing embedder for semantic search...');
      await initEmbedder();
    }

    // Load config
    const path = await import('path');
    const fullConfigPath = path.resolve(process.cwd(), configPath);
    const config = await loadBotConfig(fullConfigPath);

    // Build mock tools if requested
    const mockTools: Tool[] | undefined = includeTools
      ? [
          {
            metadata: {
              name: 'web_search',
              description: 'Search the web for current information',
              version: '1.0.0',
              author: 'system',
              keywords: ['search', 'web'],
              category: 'information' as const,
              priority: 1,
            },
            schema: {
              type: 'function' as const,
              name: 'web_search',
              description: 'Search the web',
              parameters: { type: 'object' as const, properties: {} },
            },
            validate: () => true,
            execute: async () => ({ success: true, data: {} }),
          },
          {
            metadata: {
              name: 'channel_history',
              description: 'Search conversation history in the current channel',
              version: '1.0.0',
              author: 'system',
              keywords: ['history', 'search'],
              category: 'information' as const,
              priority: 1,
            },
            schema: {
              type: 'function' as const,
              name: 'channel_history',
              description: 'Search channel history',
              parameters: { type: 'object' as const, properties: {} },
            },
            validate: () => true,
            execute: async () => ({ success: true, data: {} }),
          },
        ]
      : undefined;

    // Build the system prompt using centralized helper
    const messageContent = query ?? 'Hello!';

    // Build channel history as formatted text (matches ConversationService)
    const recentMessages = getRecentMessages(channelId, HISTORY_LIMIT + 1);
    const historyLines: string[] = [];
    const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
    const cutoffTime = Date.now() - TWO_HOURS_MS;

    for (const msg of recentMessages.reverse()) {
      if (msg.created_at < cutoffTime) continue;
      const isBot = Boolean(msg.is_bot);
      const name = isBot ? (config.bot.name ?? 'Bot') : (msg.display_name ?? msg.username ?? 'Unknown');
      historyLines.push(`- @${name}: ${msg.content}`);
    }

    const channelHistory = historyLines.length > 0 ? historyLines.join('\n') : undefined;

    const { systemPrompt, contextParts, debug } = await buildFullSystemPrompt(config, {
      messageContent,
      platform,
      guildId,
      channelId,
      userId,
      userName,
      tools: mockTools,
      skipMemories,
      skipKnowledgeSearch: !includeKnowledge,
      skipMessageSearch: !includeMessages,
      channelHistory,
    });

    // Output
    this.info(`System Prompt Preview`);
    this.info(`Bot: ${config.bot.identity ?? config.bot.name}`);
    this.info(`Platform: ${platform}`);
    this.info(`Guild: ${guildId}`);
    this.info(`Channel: ${channelId}`);
    this.info(`Tools: ${includeTools ? 'yes' : 'no'}`);
    console.log('═'.repeat(60));
    console.log('');
    console.log(systemPrompt);
    console.log('');

    // Show context parts breakdown
    if (contextParts.length > 0) {
      console.log('═'.repeat(60));
      this.info(`Context Parts (${contextParts.length})`);
      console.log('─'.repeat(60));
      this.comment(`Memories: ${debug.memoriesCount}`);
      this.comment(`History: ${debug.historyCount} messages`);
      if (debug.knowledgeCount > 0) {
        this.comment(
          `Knowledge: ${debug.knowledgeCount}${debug.topKnowledgeScore ? ` (top: ${(debug.topKnowledgeScore * 100).toFixed(0)}%)` : ''}`,
        );
      }
      if (debug.semanticResultsCount > 0) {
        this.comment(
          `Semantic results: ${debug.semanticResultsCount}${debug.topSemanticScore ? ` (top: ${(debug.topSemanticScore * 100).toFixed(0)}%)` : ''}`,
        );
      }
      console.log('');
    }

    if (query) {
      console.log('═'.repeat(60));
      this.info('Current Query (this is the only user message sent to the LLM)');
      console.log('─'.repeat(60));
      console.log(`[user] @${userName}: ${query}`);
      console.log('');
    }

    if (showFull) {
      // Now matches actual bot behavior: system + single user message
      const fullMessages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `@${userName}: ${messageContent}` },
      ];

      console.log('═'.repeat(60));
      this.info('Full LLM Messages (exactly what the bot sends)');
      console.log('─'.repeat(60));
      console.log(JSON.stringify(fullMessages, null, 2));
      console.log('');
    }

    console.log('═'.repeat(60));
    this.info(`System prompt: ${systemPrompt.length} chars`);
    this.info(`History in prompt: ${debug.historyCount} messages`);
    if (query) {
      this.info(`Query: "${query.substring(0, 50)}${query.length > 50 ? '...' : ''}"`);
    }

    return 0;
  }
}
