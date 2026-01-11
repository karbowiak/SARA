/**
 * Prompt Command - Preview the generated system prompt or simulate a query
 *
 * Usage:
 *   bun cli prompt                           - Show system prompt
 *   bun cli prompt "what is love?"          - Simulate a query with full context
 *   bun cli prompt --platform=slack         - Show prompt for specific platform
 *   bun cli prompt --tools                  - Include tool descriptions
 */

import { buildSystemPrompt, Command, loadBotConfig, type Tool } from '@core';
import { getRecentMessages, initDatabase, searchSimilar } from '../../core/database';
import { embed, initEmbedder, isEmbedderReady } from '../../core/embedder';

// Default channel for testing (your Discord channel)
const DEFAULT_GUILD_ID = '442642549971353621';
const DEFAULT_CHANNEL_ID = '1214874823063502898';

export default class PromptCommand extends Command {
  static override signature = `
    prompt
    {query? : Optional query to simulate (e.g., "what is love?")}
    {--c|config=config/config.ts : Path to config file}
    {--platform=discord : Platform to generate for (discord, slack)}
    {--tools : Include placeholder tool descriptions}
    {--channel= : Override channel ID}
    {--guild= : Override guild ID}
    {--all-channels : Search all channels for semantic matches, not just the specified one}
  `;
  static override description = 'Preview the generated system prompt or simulate a query with context';

  async handle(): Promise<number> {
    const query = this.argument('query') as string | undefined;
    const configPath = this.option('config') as string;
    const platform = (this.option('platform') as string) ?? 'discord';
    const includeTools = this.option('tools') as boolean;
    const channelId = (this.option('channel') as string) || DEFAULT_CHANNEL_ID;
    const _guildId = (this.option('guild') as string) || DEFAULT_GUILD_ID;
    const allChannels = this.option('all-channels') as boolean;

    // Initialize database
    initDatabase();

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

    // Get semantic context if we have a query
    let semanticContext = '';
    if (query && query.length >= 3) {
      this.info('Initializing embedder for semantic search...');
      await initEmbedder();

      if (isEmbedderReady()) {
        try {
          const queryEmbedding = await embed(query);
          const similar = searchSimilar({
            embedding: queryEmbedding,
            channelId: allChannels ? undefined : channelId,
            limit: 5,
            decayFactor: 0.98,
            includeBot: false,
          });

          const relevantResults = similar.filter((s) => s.score >= 0.5);
          if (relevantResults.length > 0) {
            semanticContext = this.formatSemanticResults(relevantResults);
            this.success(`Found ${relevantResults.length} relevant messages`);
          } else {
            this.comment('No relevant semantic matches found');
          }
        } catch (error) {
          this.warning(`Semantic search failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    // Build the system prompt
    const systemPrompt = buildSystemPrompt(config, {
      platform,
      tools: mockTools,
      additionalContext: semanticContext || undefined,
    });

    // Get recent history
    const recentMessages = getRecentMessages(channelId, 20);
    const historyMessages = recentMessages.reverse().map((msg) => {
      const isBot = Boolean(msg.is_bot);
      const prefix = isBot ? '' : `@${msg.user_name}: `;
      return `[${isBot ? 'assistant' : 'user'}] ${prefix}${msg.content}`;
    });

    // Output
    this.info(`System Prompt Preview`);
    this.info(`Bot: ${config.bot.identity ?? config.bot.name}`);
    this.info(`Platform: ${platform}`);
    this.info(`Channel: ${channelId}`);
    this.info(`Tools: ${includeTools ? 'yes' : 'no'}`);
    console.log('═'.repeat(60));
    console.log('');
    console.log(systemPrompt);
    console.log('');

    if (historyMessages.length > 0) {
      console.log('═'.repeat(60));
      this.info(`Recent History (${historyMessages.length} messages)`);
      console.log('─'.repeat(60));
      for (const msg of historyMessages) {
        console.log(msg);
      }
      console.log('');
    }

    if (query) {
      console.log('═'.repeat(60));
      this.info('Current Query');
      console.log('─'.repeat(60));
      console.log(`[user] @TestUser: ${query}`);
      console.log('');
    }

    console.log('═'.repeat(60));
    this.info(`System prompt: ${systemPrompt.length} chars`);
    this.info(`History: ${historyMessages.length} messages`);
    if (query) {
      this.info(`Query: "${query.substring(0, 50)}${query.length > 50 ? '...' : ''}"`);
    }

    return 0;
  }

  private formatSemanticResults(
    results: Array<{ userName: string; content: string; score: number; timestamp: number }>,
  ): string {
    const lines = results.map((r) => {
      const date = new Date(r.timestamp).toLocaleDateString();
      return `- [${date}] @${r.userName}: ${r.content.substring(0, 200)}${r.content.length > 200 ? '...' : ''} (relevance: ${(r.score * 100).toFixed(0)}%)`;
    });
    return `\n## Relevant Past Conversations\n${lines.join('\n')}`;
  }
}
