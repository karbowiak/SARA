/**
 * Bot Configuration Example
 *
 * Copy this file to config.ts and fill in your values.
 * You can also create config-<name>.ts for multiple bot configurations.
 *
 * Run with: bun cli.ts discord --config config-mybot.ts
 */

import type { BotConfig } from '@core';

const config: BotConfig = {
  /**
   * API Keys and Tokens (REQUIRED)
   */
  tokens: {
    /** Discord bot token from Discord Developer Portal */
    discord: 'YOUR_DISCORD_BOT_TOKEN',

    /** OpenRouter API key for LLM access */
    openrouter: 'YOUR_OPENROUTER_API_KEY',

    /** Tavily API key for web search (optional) */
    tavily: 'YOUR_TAVILY_API_KEY',
  },

  /**
   * Bot identity
   */
  bot: {
    /** Display name (platform-specific, may differ from identity) */
    name: 'MyBot',

    /** True identity name used in prompts (optional) */
    identity: 'MyBot',

    /** Bot's self-description */
    description: 'A helpful assistant',

    /** Developer/owner info */
    developer: 'Your Name',

    /** Project attribution (optional) */
    project: 'My Bot Project',
  },

  /**
   * AI behavior configuration
   */
  ai: {
    /** Default model (see OpenRouter for available models) */
    defaultModel: 'anthropic/claude-3.5-sonnet',

    /** Temperature (0-2, lower = more deterministic) */
    temperature: 0.7,

    /** Maximum tokens in response */
    maxTokens: 4096,
  },

  /**
   * Personality and system prompt configuration
   */
  personality: {
    /**
     * Core identity - the main "You are..." section
     */
    identity: `You are a helpful assistant in a Discord server.`,

    /**
     * Personality traits and style (optional)
     */
    traits: `## Personality
- Friendly and helpful
- Uses clear, concise language
- Adapts tone to the conversation`,

    /**
     * Behavioral guidelines
     */
    guidelines: [
      'Answer questions directly and completely',
      'Use markdown formatting when helpful',
      'Be conversational but not overly chatty',
    ],

    /**
     * Tone descriptors
     */
    tone: ['friendly', 'helpful', 'professional'],

    /**
     * Restrictions
     */
    restrictions: ['Never pretend to be a human when directly asked', 'Never generate harmful or illegal content'],

    /**
     * Image generation rules (optional, for future image tools)
     */
    imageRules: undefined,

    /**
     * Custom instructions appended to prompt (optional)
     */
    customInstructions: undefined,
  },
};

export default config;
