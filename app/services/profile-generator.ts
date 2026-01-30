/**
 * Profile Generator Service
 *
 * Shared service for generating user profiles from their message history.
 * Used by both CLI commands and slash commands.
 */

import { type BotConfig, createOpenRouterClient, getBotConfig, loadBotConfig } from '@core';
import {
  deleteGlobalInferredMemories,
  deleteInferredMemories,
  deleteMemoriesByType,
  formatMemoriesForPrompt,
  formatMessagesForProfile,
  getMemories,
  getMessagesForProfile,
  getProfileByScope,
  type StoredMemory,
  type StoredProfile,
  upsertProfile,
} from '@core/database';

// ============================================================================
// Types
// ============================================================================

export interface GenerateProfileParams {
  /** Internal user ID (from users table) */
  userId: number;
  /** Guild ID where profile is being generated (or 'dm' for DMs, 'global' for global) */
  guildId: string;
  /** Display name for formatting in prompts */
  userName: string;
  /** Override days lookback (default from config) */
  days?: number;
  /** Override max messages (default from config) */
  maxMessages?: number;
  /** If true, return prompt without calling LLM or saving */
  dryRun?: boolean;
  /** If true, create a global profile instead of guild-specific */
  isGlobal?: boolean;
}

export interface GenerateProfileResult {
  success: boolean;
  profile?: StoredProfile;
  error?: string;
  /** The prompt that was/would be sent to the LLM (for dry run or debugging) */
  prompt?: string;
  /** Number of messages analyzed */
  messagesAnalyzed?: number;
}

interface ProfileLLMResponse {
  summary?: string;
  personality?: string;
  interests?: string;
  facts?: string;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_NEW_PROFILE_DAYS = 7;
const DEFAULT_NEW_PROFILE_MAX_MESSAGES = 10000;
const DEFAULT_EXISTING_PROFILE_DAYS = 2;
const DEFAULT_EXISTING_PROFILE_MAX_MESSAGES = 500;
const MIN_MESSAGES_REQUIRED = 5;

// ============================================================================
// Main Function
// ============================================================================

/**
 * Generate or update a user profile based on their message history
 *
 * @param params - Generation parameters
 * @returns Result with success status, profile data, and optional debug info
 */
export async function generateProfile(params: GenerateProfileParams): Promise<GenerateProfileResult> {
  const { userId, guildId, userName, dryRun = false, isGlobal = false } = params;

  // Load config
  let config: BotConfig;
  try {
    config = getBotConfig();
  } catch {
    // Config not loaded yet, try to load it
    config = await loadBotConfig();
  }

  const profileConfig = config.profile ?? {};

  // Check if existing profile exists (in the appropriate scope)
  const existingProfile = getProfileByScope(userId, isGlobal ? null : guildId, isGlobal);
  const isNewProfile = !existingProfile || !existingProfile.last_generated_at;

  // Determine settings based on new vs existing profile
  const days =
    params.days ??
    (isNewProfile
      ? (profileConfig.newProfileDays ?? DEFAULT_NEW_PROFILE_DAYS)
      : (profileConfig.defaultDays ?? DEFAULT_EXISTING_PROFILE_DAYS));

  const maxMessages =
    params.maxMessages ??
    (isNewProfile
      ? (profileConfig.newProfileMaxMessages ?? DEFAULT_NEW_PROFILE_MAX_MESSAGES)
      : (profileConfig.maxMessages ?? DEFAULT_EXISTING_PROFILE_MAX_MESSAGES));

  // Calculate timestamp for message lookup
  const daysInMs = days * 24 * 60 * 60 * 1000;
  const afterTimestamp = Date.now() - daysInMs;

  // Gather data - for global profiles, pass null to get global memories
  const memories = getMemories(userId, isGlobal ? null : guildId);

  // For messages, we need a specific guild context even for global profiles
  // If guildId is 'global' or 'dm', we won't have messages to analyze
  // For now, global profiles are best generated from a guild context
  const messages =
    guildId && guildId !== 'global' && guildId !== 'dm'
      ? getMessagesForProfile({
          userId,
          guildId,
          afterTimestamp,
          limit: maxMessages,
        })
      : [];

  // Check minimum messages
  if (messages.length < MIN_MESSAGES_REQUIRED) {
    return {
      success: false,
      error: 'Not enough messages to generate profile',
      messagesAnalyzed: messages.length,
    };
  }

  // Build LLM prompt
  const prompt = buildProfilePrompt({
    existingProfile,
    memories,
    messages: formatMessagesForProfile(messages, userName),
    userName,
  });

  // If dry run, return the prompt without calling LLM
  if (dryRun) {
    return {
      success: true,
      prompt,
      messagesAnalyzed: messages.length,
    };
  }

  // Call LLM
  const model = profileConfig.model ?? config.ai?.defaultModel ?? 'anthropic/claude-sonnet-4-20250514';

  let llmResponse: ProfileLLMResponse;
  try {
    llmResponse = await callLLMForProfile(config, prompt, model);
  } catch (error) {
    return {
      success: false,
      error: `LLM error: ${error instanceof Error ? error.message : String(error)}`,
      prompt,
      messagesAnalyzed: messages.length,
    };
  }

  // Save profile with the appropriate scope
  const updatedProfile = upsertProfile({
    userId,
    guildId,
    summary: llmResponse.summary ?? null,
    personality: llmResponse.personality ?? null,
    interests: llmResponse.interests ?? null,
    facts: llmResponse.facts ?? null,
    messagesAnalyzed: messages.length,
    isGlobal,
  });

  // Clean up memories that have been incorporated into the profile
  let inferredDeleted: number;
  let profileUpdatesDeleted: number;

  if (isGlobal) {
    inferredDeleted = deleteGlobalInferredMemories(userId);
    // For global, we don't delete guild-specific profile updates
    profileUpdatesDeleted = 0;
  } else {
    inferredDeleted = deleteInferredMemories(userId, guildId);
    profileUpdatesDeleted = deleteMemoriesByType(userId, guildId, 'profile_update');
  }

  console.log(
    `[Profile] Cleaned up ${inferredDeleted} inferred + ${profileUpdatesDeleted} profile_update memories for user ${userId} (isGlobal: ${isGlobal})`,
  );

  return {
    success: true,
    profile: updatedProfile,
    messagesAnalyzed: messages.length,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

interface BuildPromptParams {
  existingProfile: StoredProfile | null;
  memories: StoredMemory[];
  messages: string;
  userName: string;
}

/**
 * Build the LLM prompt for profile generation
 */
function buildProfilePrompt(params: BuildPromptParams): string {
  const { existingProfile, memories, messages, userName } = params;

  // Format existing profile as JSON or placeholder
  let existingProfileJson: string;
  if (existingProfile && existingProfile.last_generated_at) {
    existingProfileJson = JSON.stringify(
      {
        summary: existingProfile.summary,
        personality: existingProfile.personality,
        interests: existingProfile.interests,
        facts: existingProfile.facts,
      },
      null,
      2,
    );
  } else {
    existingProfileJson = 'No existing profile - create new';
  }

  // Format memories
  const formattedMemories = memories.length > 0 ? formatMemoriesForPrompt(memories, userName) : 'No memories saved yet';

  // Filter for profile update memories
  const profileUpdateMemories = memories.filter((m) => m.type === 'profile_update');
  const profileUpdatesText =
    profileUpdateMemories.length > 0 ? profileUpdateMemories.map((m) => `- ${m.content}`).join('\n') : 'None';

  return `You are updating a user profile based on their recent Discord messages. Be factual, friendly, and concise.

## Existing Profile
${existingProfileJson}

Note: The user may have manually edited this profile. Treat existing content as authoritative - incorporate it into your updated profile rather than discarding it. Only modify information that is clearly contradicted by recent messages.

## Memories About This User
${formattedMemories}

## Flagged Profile Updates
${profileUpdatesText}

## Recent Messages from @${userName}
Note: Messages marked with "↳ replying to" show context. Focus your analysis on ${userName}'s messages - other users' messages are included only for context.

${messages}

## Task
Create or update the user profile with these sections. Each section should be 1-4 concise bullet points or sentences. Max 2000 characters per section.

### Summary
A 1-2 sentence friendly description of who this person seems to be.

### Personality
Their communication style - are they sarcastic, earnest, technical, casual? How do they engage with others?

### Interests
Topics they discuss, hobbies, things they seem passionate about.

### Facts
Concrete information they've shared: job, location, projects, preferences, etc. Only include things explicitly stated.

## Rules
- Be warm but factual - you're noting observations, not psychoanalyzing
- If the existing profile has info not contradicted by new messages, keep it
- If new messages contradict old profile info, update it
- Omit sections if there's genuinely nothing to say
- Never make up information or speculate beyond what's stated

## Output Format
Respond with ONLY a JSON object (no markdown code blocks):
{"summary": "...", "personality": "...", "interests": "...", "facts": "..."}`;
}

/**
 * Call the LLM to generate profile content
 */
async function callLLMForProfile(config: BotConfig, prompt: string, model: string): Promise<ProfileLLMResponse> {
  const client = createOpenRouterClient(config.tokens.openrouter, {
    baseUrl: config.ai?.openRouterBaseUrl,
    defaultModel: model,
    defaultTemperature: 0.7,
    defaultMaxTokens: 2048,
  });

  const response = await client.complete(prompt, {
    model,
    temperature: 0.7,
  });

  // Parse JSON response
  return parseProfileResponse(response);
}

/**
 * Parse the LLM response, handling various formats
 */
function parseProfileResponse(response: string): ProfileLLMResponse {
  // Trim whitespace
  let text = response.trim();

  // Remove markdown code blocks if present
  if (text.startsWith('```json')) {
    text = text.slice(7);
  } else if (text.startsWith('```')) {
    text = text.slice(3);
  }
  if (text.endsWith('```')) {
    text = text.slice(0, -3);
  }
  text = text.trim();

  // Try to parse as JSON
  try {
    const parsed = JSON.parse(text) as ProfileLLMResponse;
    return {
      summary: typeof parsed.summary === 'string' ? parsed.summary : undefined,
      personality: typeof parsed.personality === 'string' ? parsed.personality : undefined,
      interests: typeof parsed.interests === 'string' ? parsed.interests : undefined,
      facts: typeof parsed.facts === 'string' ? parsed.facts : undefined,
    };
  } catch {
    // If JSON parsing fails, try to extract JSON from the text
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]) as ProfileLLMResponse;
        return {
          summary: typeof parsed.summary === 'string' ? parsed.summary : undefined,
          personality: typeof parsed.personality === 'string' ? parsed.personality : undefined,
          interests: typeof parsed.interests === 'string' ? parsed.interests : undefined,
          facts: typeof parsed.facts === 'string' ? parsed.facts : undefined,
        };
      } catch {
        // Fall through to error
      }
    }

    throw new Error(`Failed to parse LLM response as JSON: ${text.substring(0, 200)}...`);
  }
}
