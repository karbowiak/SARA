/**
 * Bot Configuration Example
 *
 * Copy this file to config.ts and fill in your values.
 * You can also create config-<name>.ts for multiple bot configurations.
 *
 * Run with: bun cli.ts discord --config config/config-mybot.ts
 */

import type { BotConfig } from '@core';

const config: BotConfig = {
  // ============================================
  // API TOKENS (Required)
  // ============================================
  tokens: {
    /**
     * Discord bot token
     * Get from: https://discord.com/developers/applications
     */
    discord: 'YOUR_DISCORD_BOT_TOKEN',

    /**
     * OpenRouter API key for LLM access
     * Get from: https://openrouter.ai/keys
     */
    openrouter: 'YOUR_OPENROUTER_API_KEY',

    /**
     * Tavily API key for web search (optional)
     * Get from: https://tavily.com/
     * If not provided, web_search tool won't work
     */
    tavily: 'YOUR_TAVILY_API_KEY',
  },

  // ============================================
  // BOT IDENTITY
  // ============================================
  bot: {
    /**
     * Display name shown in logs and some contexts
     * This might differ from the Discord bot username
     */
    name: 'MyBot',

    /**
     * Identity name used in AI prompts
     * The AI will refer to itself by this name
     * Can be different from `name` (e.g., Discord name "Tim" but identity "Sara")
     */
    identity: 'MyBot',

    /**
     * Brief description of the bot's purpose
     */
    description: 'A helpful assistant',

    /**
     * Developer/owner name (shown in some contexts)
     */
    developer: 'Your Name',

    /**
     * Project name (optional, for attribution)
     */
    project: 'My Bot Project',
  },

  // ============================================
  // AI BEHAVIOR
  // ============================================
  ai: {
    /**
     * Default LLM model to use
     * See OpenRouter docs for available models:
     * https://openrouter.ai/docs#models
     *
     * Popular options:
     * - 'anthropic/claude-sonnet-4-20250514' (Claude Sonnet 4 - balanced)
     * - 'anthropic/claude-opus-4-20250514' (Claude Opus 4 - most capable)
     * - 'openai/gpt-4o' (GPT-4o - fast multimodal)
     * - 'openai/gpt-4-turbo' (GPT-4 Turbo)
     * - 'google/gemini-pro-1.5' (Gemini 1.5 Pro)
     * - 'x-ai/grok-3-latest' (Grok 3)
     * - 'meta-llama/llama-3.1-405b-instruct' (Llama 3.1 405B)
     */
    defaultModel: 'anthropic/claude-sonnet-4-20250514',

    /**
     * Temperature (0.0 - 2.0)
     * Lower = more deterministic/focused
     * Higher = more creative/random
     *
     * Recommendations:
     * - 0.0-0.3: Factual, code, math
     * - 0.5-0.7: General chat (default)
     * - 0.8-1.2: Creative writing
     */
    temperature: 0.7,

    /**
     * Maximum tokens in AI response
     * Higher = longer possible responses but more cost
     * Most models support 4096-8192, some up to 128k
     */
    maxTokens: 4096,
  },

  // ============================================
  // PERSONALITY (System Prompt)
  // ============================================
  personality: {
    /**
     * Core identity prompt
     * The main "You are..." section that defines who the bot is
     */
    identity: 'You are a helpful assistant in a Discord server.',

    /**
     * Personality traits and behavioral style (optional)
     * Markdown formatted description of how the bot should behave
     */
    traits: `## Personality
- Friendly and helpful
- Uses clear, concise language
- Adapts tone to match the conversation`,

    /**
     * Specific behavioral guidelines
     * Array of rules the AI should follow
     */
    guidelines: [
      'Answer questions directly and completely',
      'Use markdown formatting when helpful',
      'Be conversational but not overly chatty',
      'Never end responses with follow-up questions unless clarification is needed',
    ],

    /**
     * Tone descriptors
     * Short words describing the communication style
     */
    tone: ['friendly', 'helpful', 'professional'],

    /**
     * Hard restrictions
     * Things the bot must never do
     */
    restrictions: ['Never pretend to be a human when directly asked', 'Never generate harmful or illegal content'],

    /**
     * Image generation rules (optional)
     * If you add image generation tools, put safety rules here
     */
    imageRules: undefined,

    /**
     * Custom instructions (optional)
     * Additional instructions appended to the system prompt
     */
    customInstructions: undefined,
  },

  // ============================================
  // ACCESS GROUPS (Optional)
  // ============================================
  /**
   * Define named groups that map to platform-specific role/user IDs.
   * These groups are referenced in plugins/tools access config.
   *
   * If not defined or empty, group-based access control is disabled.
   *
   * To get Discord role IDs:
   * 1. Enable Developer Mode in Discord Settings > Advanced
   * 2. Right-click a role in Server Settings > Roles → Copy ID
   *
   * To get Discord user IDs:
   * 1. Enable Developer Mode
   * 2. Right-click a user → Copy ID
   */
  accessGroups: {
    /**
     * Admin group - highest access level
     * Usually server owners and trusted admins
     */
    admin: {
      discord: [
        '111111111111111111', // Admin role ID
      ],
    },

    /**
     * Moderator group - elevated access
     * Include admin role so admins also have mod access
     */
    moderator: {
      discord: [
        '111111111111111111', // Admin role (admins are also mods)
        '222222222222222222', // Moderator role ID
      ],
    },

    /**
     * VIP/Premium group - special users
     */
    vip: {
      discord: [
        '333333333333333333', // VIP role ID
        '444444444444444444', // Booster role ID
      ],
    },

    /**
     * Trusted group - verified members
     */
    trusted: {
      discord: [
        '111111111111111111', // Admin
        '222222222222222222', // Moderator
        '333333333333333333', // VIP
        '555555555555555555', // Verified role ID
      ],
    },
  },

  // ============================================
  // PLUGINS TO LOAD
  // ============================================
  /**
   * Configure which plugins to load and their access rules.
   *
   * Key: Plugin ID (matches the `id` property in the plugin class)
   * Value: Access configuration object
   *
   * ACCESS CONFIGURATION OPTIONS:
   * - {} = Everyone can use (no restrictions)
   * - { groups: ['admin'] } = Only users in named groups (from accessGroups)
   * - { users: ['123...'] } = Only specific user IDs
   * - { roles: ['456...'] } = Only users with specific role IDs
   * - { guilds: ['789...'] } = Only in specific guild/server IDs
   *
   * Multiple conditions are OR'd - if ANY match, access is granted.
   * Example: { groups: ['admin'], users: ['123'] } = admin group OR user 123
   *
   * IMPORTANT: Plugins not listed here are NOT loaded at all.
   */
  plugins: {
    // ============================================
    // Message Handlers
    // ============================================

    /**
     * AI plugin - responds to @mentions with AI
     *
     * Examples:
     * - {} = Everyone can use
     * - { groups: ['trusted'] } = Only trusted users
     * - { guilds: ['123...'] } = Only in specific server
     */
    ai: {},

    /**
     * Logger plugin - logs all messages to console/database
     * Should always be {} so all messages are logged for context
     */
    logger: {},

    // ============================================
    // Slash Commands
    // ============================================

    /**
     * /ping - Simple latency test
     */
    ping: {},

    /**
     * /demo - Demonstrates bot features
     * Restricted to admin group
     */
    demo: {
      groups: ['admin'],
    },

    /**
     * /memory - View/manage user memories
     * Uses subcommand-level access control
     */
    memory: {
      // Subcommand-specific access (overrides parent)
      subcommands: {
        list: {}, // Everyone
        delete: {}, // Everyone
        clear: { groups: ['admin'] }, // Admin only
      },
    },

    // ============================================
    // More Examples (commented out)
    // ============================================

    /**
     * Example: Restrict to specific user IDs
     * Only these users can use the command
     */
    // ownerOnly: {
    //   users: [
    //     '123456789012345678', // Your user ID
    //     '234567890123456789', // Co-owner user ID
    //   ],
    // },

    /**
     * Example: Restrict to specific guilds/servers
     * Command only works in these servers
     */
    // privateServer: {
    //   guilds: [
    //     '111222333444555666', // Main server
    //     '222333444555666777', // Test server
    //   ],
    // },

    /**
     * Example: Restrict by role ID directly
     * Bypasses accessGroups, checks role IDs directly
     */
    // premiumFeature: {
    //   roles: [
    //     '999888777666555444', // Premium role ID
    //     '888777666555444333', // Legacy premium role ID
    //   ],
    // },

    /**
     * Example: Multiple conditions (OR'd together)
     * Access granted if ANY condition matches
     */
    // flexibleAccess: {
    //   groups: ['admin'],                // Admin group members
    //   users: ['123456789012345678'],    // OR this specific user
    //   roles: ['999888777666555444'],    // OR anyone with this role
    //   guilds: ['111222333444555666'],   // OR anyone in this guild
    // },

    /**
     * Example: Guild + Role restriction (AND-like behavior)
     * To require BOTH conditions, use roles within a specific guild
     * (User must have the role AND be in a guild where it exists)
     */
    // guildSpecificRole: {
    //   roles: ['999888777666555444'], // Role only exists in certain guilds
    // },
  },

  // ============================================
  // AI TOOLS TO LOAD
  // ============================================
  /**
   * Configure which AI tools to load and their access rules.
   *
   * Key: Tool name (matches `metadata.name` in the tool class)
   * Value: Access configuration object (same format as plugins)
   *
   * Tools are filtered PER-USER before the AI sees them.
   * If a user doesn't have access, the AI won't know the tool exists.
   *
   * IMPORTANT: Tools not listed here are NOT loaded at all.
   */
  tools: {
    /**
     * memory - Save/recall user preferences and facts
     */
    memory: {},

    /**
     * channel_history - Search message history in current channel
     */
    channel_history: {},

    /**
     * web_search - Search the web via Tavily
     * Requires tavily token in tokens config
     */
    web_search: {},

    /**
     * last_seen - Check when a user was last active
     */
    last_seen: {},

    // ============================================
    // More Examples (commented out)
    // ============================================

    /**
     * Example: Admin-only tool
     * Only admins can trigger this tool via AI
     */
    // dangerous_action: {
    //   groups: ['admin'],
    // },

    /**
     * Example: Guild-restricted tool
     * Tool only available in specific servers
     */
    // private_data: {
    //   guilds: ['111222333444555666'],
    // },

    /**
     * Example: VIP feature
     * Premium/VIP users get access to special tools
     */
    // premium_search: {
    //   groups: ['vip'],
    // },

    /**
     * Example: Moderator tool
     * Mods and admins can use moderation tools
     */
    // mod_lookup: {
    //   groups: ['moderator'], // Remember: admins are in moderator group too
    // },
  },
};

export default config;
