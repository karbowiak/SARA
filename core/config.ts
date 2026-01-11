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
  discord: string;
  /** OpenRouter API key */
  openrouter: string;
  /** Tavily API key (optional, for web search) */
  tavily?: string;
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
