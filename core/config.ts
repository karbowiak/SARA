/**
 * Bot Configuration Types and Loader
 *
 * Provides type definitions for bot configuration and utilities
 * for loading config and building system prompts.
 */

import type { Tool } from './types/tool';

/**
 * API tokens and keys
 */
export interface TokensConfig {
  /** Discord bot token */
  discord?: string;
  /** Slack tokens */
  slack?: {
    botToken: string;
    appToken: string;
  };
  /** OpenRouter API key */
  openrouter: string;
  /** Tavily API key (optional, for web search) */
  tavily?: string;
  /** Instagram cookies (base64 encoded Netscape cookie file) */
  instagramCookies?: string;
}

/**
 * Bot identity configuration
 */
export interface BotIdentityConfig {
  /** Display name the bot uses (platform-specific) */
  name: string;
  /** True identity name (may differ from display name) */
  identity?: string;
  /** Bot's self-description */
  description?: string;
  /** Developer/owner name */
  developer?: string;
  /** Project attribution */
  project?: string;
}

/**
 * AI behavior configuration
 */
export interface AIBehaviorConfig {
  /** Default model to use */
  defaultModel?: string;
  /** Model for image generation (used by AI tool) */
  imageModel?: string;
  /** Additional image models available in /imagine command */
  imageModels?: string[];
  /** Model for deep reasoning/thinking */
  reasoningModel?: string;
  /** Temperature for responses (0-2) */
  temperature?: number;
  /** Maximum tokens in response */
  maxTokens?: number;
}

/**
 * Personality configuration for system prompt
 */
export interface PersonalityConfig {
  /** Core identity description ("You are...") */
  identity: string;
  /** Extended personality traits and style */
  traits?: string;
  /** Behavioral guidelines */
  guidelines?: string[];
  /** Tone descriptors */
  tone?: string[];
  /** Things the bot should never do */
  restrictions?: string[];
  /** Image generation rules (for image tools) */
  imageRules?: string;
  /** Custom instructions to append */
  customInstructions?: string;
}

// ============================================
// Access Control Types
// ============================================

/**
 * Platform-specific role/user mappings for an access group
 */
export interface PlatformAccess {
  /** Discord role IDs that belong to this group */
  discord?: string[];
  /** Slack user/group IDs that belong to this group */
  slack?: string[];
}

/**
 * Access groups map friendly names to platform-specific IDs
 * Example: { admin: { discord: ['123456'] }, moderator: { discord: ['789'] } }
 */
export type AccessGroups = Record<string, PlatformAccess>;

/**
 * Access configuration for a single feature (plugin/tool)
 * Empty object {} = everyone can use
 * { groups: ['admin'] } = only admin group
 * { users: ['123'] } = only specific user IDs
 * { guilds: ['456'] } = only in specific guilds
 * { roles: ['789'] } = only users with specific role IDs
 * Multiple conditions are OR'd together (any match = access granted)
 */
export interface FeatureAccess {
  /** Groups that can access this feature (from accessGroups config) */
  groups?: string[];
  /** Specific user IDs that can access this feature */
  users?: string[];
  /** Specific guild IDs where this feature can be used */
  guilds?: string[];
  /** Specific role IDs that can access this feature (platform-specific) */
  roles?: string[];
  /** Subcommand-level access for slash commands */
  subcommands?: Record<string, FeatureAccess>;
}

/**
 * Plugins configuration - maps plugin IDs to their access config
 * Plugins not listed here are NOT loaded
 */
export type PluginsConfig = Record<string, FeatureAccess>;

/**
 * Tools configuration - maps tool names to their access config
 * Tools not listed here are NOT loaded
 */
export type ToolsConfig = Record<string, FeatureAccess>;

/**
 * Guild whitelist configuration
 */
export interface GuildsConfig {
  /** If set, only these guild IDs are allowed. Bot leaves all others. */
  whitelist?: string[];
  /** Message(s) to send before leaving unauthorized guilds. If array, picks one at random. */
  unauthorizedMessages?: string | string[];
}

/**
 * Complete bot configuration
 */
export interface BotConfig {
  /** API tokens and keys */
  tokens: TokensConfig;
  /** Bot identity */
  bot: BotIdentityConfig;
  /** AI behavior settings */
  ai?: AIBehaviorConfig;
  /** Personality configuration */
  personality: PersonalityConfig;
  /** Access group definitions (optional - if not set, no access control) */
  accessGroups?: AccessGroups;
  /** Plugins to load and their access config */
  plugins?: PluginsConfig;
  /** Tools to load and their access config */
  tools?: ToolsConfig;
  /** Guild whitelist configuration (optional - if not set, all guilds allowed) */
  guilds?: GuildsConfig;
}

// ============================================
// Access Control Utilities
// ============================================

/**
 * User context for access checking
 */
export interface AccessContext {
  /** Platform (discord, slack, etc.) */
  platform: string;
  /** User's role IDs (Discord) or group IDs (Slack) */
  roleIds?: string[];
  /** User ID */
  userId?: string;
  /** Guild/Server ID */
  guildId?: string;
}

/**
 * Check if a feature access config has any restrictions
 */
function hasRestrictions(featureAccess: FeatureAccess): boolean {
  return !!(
    (featureAccess.groups && featureAccess.groups.length > 0) ||
    (featureAccess.users && featureAccess.users.length > 0) ||
    (featureAccess.guilds && featureAccess.guilds.length > 0) ||
    (featureAccess.roles && featureAccess.roles.length > 0)
  );
}

/**
 * Check if a user has access to a feature based on config
 *
 * Access rules are OR'd together - if ANY condition matches, access is granted.
 * Empty {} = everyone has access.
 *
 * @param featureAccess - The feature's access configuration
 * @param context - User's access context (platform, roles, userId, guildId)
 * @param config - Bot configuration (optional, for group resolution)
 * @returns true if user has access, false otherwise
 */
export function checkAccess(
  featureAccess: FeatureAccess | undefined,
  context: AccessContext,
  config?: BotConfig,
): boolean {
  // No access config = everyone has access
  if (!featureAccess) {
    return true;
  }

  // Empty config (no restrictions) = everyone has access
  if (!hasRestrictions(featureAccess)) {
    return true;
  }

  // Check direct user ID match
  if (featureAccess.users && featureAccess.users.length > 0) {
    if (context.userId && featureAccess.users.includes(context.userId)) {
      return true;
    }
  }

  // Check guild restriction
  if (featureAccess.guilds && featureAccess.guilds.length > 0) {
    if (context.guildId && featureAccess.guilds.includes(context.guildId)) {
      return true;
    }
  }

  // Check direct role ID match
  if (featureAccess.roles && featureAccess.roles.length > 0) {
    if (context.roleIds) {
      for (const roleId of context.roleIds) {
        if (featureAccess.roles.includes(roleId)) {
          return true;
        }
      }
    }
  }

  // Check group membership (requires config with accessGroups)
  if (featureAccess.groups && featureAccess.groups.length > 0 && config?.accessGroups) {
    for (const groupName of featureAccess.groups) {
      const group = config.accessGroups[groupName];
      if (!group) continue;

      // Get platform-specific IDs for this group
      const platformIds = group[context.platform as keyof PlatformAccess];
      if (!platformIds || platformIds.length === 0) continue;

      // Check if any of user's roles match
      if (context.roleIds) {
        for (const roleId of context.roleIds) {
          if (platformIds.includes(roleId)) {
            return true;
          }
        }
      }

      // Also check user ID directly (for Slack user-based access)
      if (context.userId && platformIds.includes(context.userId)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Check access to a specific subcommand
 */
export function checkSubcommandAccess(
  featureAccess: FeatureAccess | undefined,
  subcommand: string,
  context: AccessContext,
  config?: BotConfig,
): boolean {
  // First check if there's subcommand-specific access
  if (featureAccess?.subcommands?.[subcommand]) {
    return checkAccess(featureAccess.subcommands[subcommand], context, config);
  }

  // Fall back to parent feature access
  return checkAccess(featureAccess, context, config);
}

/**
 * Get list of tools accessible to a user
 */
export function getAccessibleTools(allTools: Tool[], context: AccessContext, config?: BotConfig): Tool[] {
  if (!config?.tools) return allTools; // No config = all tools accessible

  return allTools.filter((tool) => {
    const toolName = tool.metadata.name;
    const toolAccess = config.tools?.[toolName];

    // Tool not in config = not loaded (shouldn't happen if tool loader filtered)
    if (toolAccess === undefined) return false;

    // Check access
    return checkAccess(toolAccess, context, config);
  });
}

/**
 * Context for building dynamic system prompt
 */
export interface PromptContext {
  /** Platform the message is from */
  platform: string;
  /** Available tools */
  tools?: Tool[];
  /** Whether image tools are available */
  hasImageTools?: boolean;
  /** Additional context to inject */
  additionalContext?: string;
}

/**
 * Default configuration when no config is provided
 */
const _DEFAULT_CONFIG: Partial<BotConfig> = {
  tokens: {
    discord: '',
    openrouter: '',
  },
  bot: {
    name: 'Bot',
    description: 'A helpful AI assistant',
  },
  personality: {
    identity: 'You are a helpful AI assistant in a chat server.',
    guidelines: [
      'Keep responses concise unless asked for detail',
      'Use markdown formatting when helpful',
      "If you don't know something, say so",
      'Be conversational and natural',
    ],
  },
};

let loadedConfig: BotConfig | null = null;
let configPath: string | null = null;

/**
 * Set the config path to use (call before loadBotConfig)
 */
export function setConfigPath(path: string): void {
  configPath = path;
  loadedConfig = null; // Clear cached config
}

/**
 * Get the current config path
 */
export function getConfigPath(): string {
  return configPath ?? `${process.cwd()}/config/config.ts`;
}

/**
 * Load bot configuration from config file
 * @param customPath Optional path override (for CLI --config flag)
 */
export async function loadBotConfig(customPath?: string): Promise<BotConfig> {
  if (loadedConfig && !customPath) return loadedConfig;

  const path = customPath ?? configPath ?? `${process.cwd()}/config/config.ts`;

  try {
    const configModule = await import(path);
    loadedConfig = configModule.default as BotConfig;
    configPath = path;
    return loadedConfig;
  } catch (error) {
    throw new Error(
      `Failed to load config from ${path}: ${error instanceof Error ? error.message : String(error)}\n` +
        `Create a config file by copying config/config.example.ts to config/config.ts`,
    );
  }
}

/**
 * Get the loaded config synchronously (must call loadBotConfig first)
 * Throws if config hasn't been loaded yet.
 */
export function getBotConfig(): BotConfig {
  if (!loadedConfig) {
    throw new Error('Config not loaded. Call loadBotConfig() first.');
  }
  return loadedConfig;
}

/**
 * Build the complete system prompt from config and context
 */
export function buildSystemPrompt(config: BotConfig, context: PromptContext): string {
  const sections: string[] = [];
  const botIdentity = config.bot.identity ?? config.bot.name;

  // 1. Bot Identity section
  let identitySection = `# Bot Identity\n- **Name:** ${botIdentity}`;
  if (config.bot.developer) {
    identitySection += `\n- **Developer:** ${config.bot.developer}`;
  }
  if (config.bot.description) {
    identitySection += `\n- **Purpose:** ${config.bot.description}`;
  }
  if (config.bot.project) {
    identitySection += `\n- **Source:** ${config.bot.project}`;
  }
  sections.push(identitySection);

  // 2. Role and personality
  sections.push(`# Role and Objective\n${config.personality.identity}`);

  // 3. Personality traits (if defined)
  if (config.personality.traits) {
    sections.push(config.personality.traits);
  }

  // 4. Guidelines section
  if (config.personality.guidelines?.length) {
    const guidelinesText = config.personality.guidelines.map((g) => `- ${g}`).join('\n');
    sections.push(`# Guidelines\n${guidelinesText}`);
  }

  // 5. Restrictions section
  if (config.personality.restrictions?.length) {
    const restrictionsText = config.personality.restrictions.map((r) => `- ${r}`).join('\n');
    sections.push(`# Restrictions\n${restrictionsText}`);
  }

  // 6. Image rules (only if image tools available or always include for future)
  if (config.personality.imageRules) {
    sections.push(config.personality.imageRules);
  }

  // 7. Tool descriptions (if any)
  if (context.tools?.length) {
    const toolDescriptions = context.tools.map((t) => `- **${t.metadata.name}**: ${t.metadata.description}`).join('\n');
    sections.push(
      `# Available Tools\nYou have access to the following tools. Use them when they would improve your response:\n${toolDescriptions}`,
    );
  }

  // 8. Platform-specific formatting
  sections.push(getPlatformFormatting(context.platform, botIdentity));

  // 9. Dynamic context (date/time)
  const now = new Date();
  const contextSection = `# Current Context\n- Date: ${now.toISOString().split('T')[0]}\n- Time: ${now.toISOString().substring(11, 19)} UTC`;
  sections.push(contextSection);

  // 10. Additional context (if provided)
  if (context.additionalContext) {
    sections.push(context.additionalContext);
  }

  // 11. Custom instructions (if any)
  if (config.personality.customInstructions) {
    sections.push(config.personality.customInstructions);
  }

  return sections.join('\n\n');
}

/**
 * Get platform-specific formatting instructions
 */
function getPlatformFormatting(platform: string, botName: string): string {
  const common = `# Message Format
- Messages are prefixed with @Username: to show who is speaking - this IS the person talking to you
- To address or mention a user, use @Username format (e.g., @Karbowiak) - this will be converted to a proper platform mention
- The conversation history shows previous messages in the channel`;

  switch (platform) {
    case 'discord':
      return `${common}
- Use Discord markdown: **bold**, *italic*, \`code\`, \`\`\`codeblock\`\`\`
- You are ${botName} - when users @mention you, respond naturally`;

    case 'slack':
      return `${common}
- Use Slack markdown: *bold*, _italic_, \`code\`, \`\`\`codeblock\`\`\`
- You are ${botName} - when users @mention you, respond naturally`;

    default:
      return `${common}
- Use markdown formatting when helpful
- You are ${botName}`;
  }
}

/**
 * Build a simple prompt without full context (for quick use)
 */
export function buildSimplePrompt(config: BotConfig): string {
  let prompt = config.personality.identity;

  if (config.personality.guidelines?.length) {
    prompt += `\n\nGuidelines:\n${config.personality.guidelines.map((g) => `- ${g}`).join('\n')}`;
  }

  return prompt;
}
