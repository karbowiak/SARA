/**
 * Profile Repository - Manages user profile data in the database
 */

import { getDb } from './client';

export interface StoredProfile {
  id: number;
  user_id: number;
  guild_id: string;
  summary: string | null;
  personality: string | null;
  interests: string | null;
  facts: string | null;
  opted_out: number; // 0 or 1
  is_global: number; // 0 = per-guild, 1 = global
  messages_analyzed: number;
  last_generated_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface UpsertProfileParams {
  userId: number;
  guildId: string;
  summary?: string | null;
  personality?: string | null;
  interests?: string | null;
  facts?: string | null;
  messagesAnalyzed?: number;
  isGlobal?: boolean;
}

export interface ProfileForPrompt {
  summary: string | null;
  personality: string | null;
  interests: string | null;
  facts: string | null;
}

/** Rate limit for profile generation: 24 hours in milliseconds */
const RATE_LIMIT_MS = 24 * 60 * 60 * 1000;

/**
 * Get profile for a user in a guild
 * Returns global profile if exists, otherwise guild-specific profile
 * Returns null if not found
 */
export function getProfile(userId: number, guildId: string | null): StoredProfile | null {
  const db = getDb();
  const scope = guildId ?? 'dm';

  // First try to get global profile
  const globalProfile = db
    .prepare<StoredProfile, [number, number]>(`
      SELECT * FROM user_profiles 
      WHERE user_id = ? AND is_global = ?
    `)
    .get(userId, 1);

  if (globalProfile) {
    return globalProfile;
  }

  // Fall back to guild/dm-specific profile
  return (
    db
      .prepare<StoredProfile, [number, string, number]>(`
        SELECT * FROM user_profiles 
        WHERE user_id = ? AND guild_id = ? AND is_global = ?
      `)
      .get(userId, scope, 0) ?? null
  );
}

/**
 * Get profile by specific scope (guild-specific OR global, not fallback)
 */
export function getProfileByScope(userId: number, guildId: string | null, isGlobal: boolean): StoredProfile | null {
  const db = getDb();

  if (isGlobal) {
    return (
      db
        .prepare<StoredProfile, [number, number]>(`
          SELECT * FROM user_profiles 
          WHERE user_id = ? AND is_global = ?
        `)
        .get(userId, 1) ?? null
    );
  }

  const scope = guildId ?? 'dm';
  return (
    db
      .prepare<StoredProfile, [number, string, number]>(`
        SELECT * FROM user_profiles 
        WHERE user_id = ? AND guild_id = ? AND is_global = ?
      `)
      .get(userId, scope, 0) ?? null
  );
}

/**
 * Create or update a profile
 * Updates last_generated_at and updated_at timestamps
 */
export function upsertProfile(params: UpsertProfileParams): StoredProfile {
  const db = getDb();
  const now = Date.now();
  const isGlobal = params.isGlobal ? 1 : 0;
  const scope = isGlobal ? 'global' : (params.guildId ?? 'dm');

  const existing = getProfileByScope(params.userId, params.guildId, params.isGlobal ?? false);

  if (existing) {
    // Update existing profile
    db.prepare(`
      UPDATE user_profiles SET
        summary = ?,
        personality = ?,
        interests = ?,
        facts = ?,
        messages_analyzed = ?,
        last_generated_at = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      params.summary ?? existing.summary,
      params.personality ?? existing.personality,
      params.interests ?? existing.interests,
      params.facts ?? existing.facts,
      params.messagesAnalyzed ?? existing.messages_analyzed,
      now,
      now,
      existing.id,
    );

    return getProfileByScope(params.userId, params.guildId, params.isGlobal ?? false)!;
  }

  // Create new profile
  db.prepare(`
    INSERT INTO user_profiles (
      user_id, guild_id, summary, personality, interests, facts,
      opted_out, is_global, messages_analyzed, last_generated_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
  `).run(
    params.userId,
    scope,
    params.summary ?? null,
    params.personality ?? null,
    params.interests ?? null,
    params.facts ?? null,
    isGlobal,
    params.messagesAnalyzed ?? 0,
    now,
    now,
    now,
  );

  return getProfileByScope(params.userId, params.guildId, params.isGlobal ?? false)!;
}

/**
 * Set the opted_out flag for a user
 * Creates a minimal profile record if none exists
 */
export function setOptOut(userId: number, guildId: string | null, optedOut: boolean, isGlobal?: boolean): void {
  const db = getDb();
  const now = Date.now();
  const globalFlag = isGlobal ? 1 : 0;
  const scope = isGlobal ? 'global' : (guildId ?? 'dm');

  const existing = getProfileByScope(userId, guildId, isGlobal ?? false);

  if (existing) {
    db.prepare(`
      UPDATE user_profiles SET
        opted_out = ?,
        updated_at = ?
      WHERE id = ?
    `).run(optedOut ? 1 : 0, now, existing.id);
  } else {
    // Create minimal profile with opt-out status
    db.prepare(`
      INSERT INTO user_profiles (
        user_id, guild_id, summary, personality, interests, facts,
        opted_out, is_global, messages_analyzed, last_generated_at, created_at, updated_at
      ) VALUES (?, ?, NULL, NULL, NULL, NULL, ?, ?, 0, NULL, ?, ?)
    `).run(userId, scope, optedOut ? 1 : 0, globalFlag, now, now);
  }
}

/**
 * Returns true if user has opted out, false otherwise
 * Returns false if no profile exists (default is opted-in)
 * Checks global profile first, then guild-specific
 */
export function getOptOutStatus(userId: number, guildId: string | null): boolean {
  const profile = getProfile(userId, guildId);
  return profile?.opted_out === 1;
}

/**
 * Check if user can generate a profile (rate limit: 24 hours)
 * Returns canGenerate: true if no profile exists or last_generated_at > 24h ago
 * Returns nextAvailable date if rate limited
 */
export function canGenerateProfile(
  userId: number,
  guildId: string | null,
  isGlobal?: boolean,
): { canGenerate: boolean; nextAvailable?: Date } {
  const profile = isGlobal !== undefined ? getProfileByScope(userId, guildId, isGlobal) : getProfile(userId, guildId);

  // No profile exists - can generate
  if (!profile || profile.last_generated_at === null) {
    return { canGenerate: true };
  }

  const now = Date.now();
  const timeSinceLastGeneration = now - profile.last_generated_at;

  if (timeSinceLastGeneration >= RATE_LIMIT_MS) {
    return { canGenerate: true };
  }

  // Rate limited - calculate next available time
  const nextAvailable = new Date(profile.last_generated_at + RATE_LIMIT_MS);
  return { canGenerate: false, nextAvailable };
}

/**
 * Format profile for injection into system prompt
 * Returns markdown formatted string
 * Only includes sections that have content
 * Returns empty string if all sections are null/empty
 */
export function formatProfileForPrompt(profile: StoredProfile, userName: string): string {
  const sections: string[] = [];

  if (profile.summary?.trim()) {
    sections.push(`**Summary:** ${profile.summary.trim()}`);
  }

  if (profile.personality?.trim()) {
    sections.push(`**Personality:** ${profile.personality.trim()}`);
  }

  if (profile.interests?.trim()) {
    sections.push(`**Interests:** ${profile.interests.trim()}`);
  }

  if (profile.facts?.trim()) {
    sections.push(`**Facts:** ${profile.facts.trim()}`);
  }

  // Return empty string if no content
  if (sections.length === 0) {
    return '';
  }

  return `## What You Know About @${userName}\n\n${sections.join('\n\n')}`;
}

// =============================================================================
// Migration Functions (for /migrate command)
// =============================================================================

/**
 * Migrate profile from guild-specific to global
 * Returns true if migration was successful
 */
export function migrateProfileToGlobal(userId: number, fromGuildId: string): boolean {
  const db = getDb();
  const now = Date.now();

  const existing = getProfileByScope(userId, fromGuildId, false);
  if (!existing) {
    return false;
  }

  // Check if global profile already exists
  const globalProfile = getProfileByScope(userId, null, true);
  if (globalProfile) {
    // Merge: update global profile with source data
    db.prepare(`
      UPDATE user_profiles SET
        summary = COALESCE(?, summary),
        personality = COALESCE(?, personality),
        interests = COALESCE(?, interests),
        facts = COALESCE(?, facts),
        messages_analyzed = messages_analyzed + ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      existing.summary,
      existing.personality,
      existing.interests,
      existing.facts,
      existing.messages_analyzed,
      now,
      globalProfile.id,
    );

    // Delete the source guild-specific profile
    db.prepare(`DELETE FROM user_profiles WHERE id = ?`).run(existing.id);
  } else {
    // Convert to global
    db.prepare(`
      UPDATE user_profiles SET
        is_global = 1,
        guild_id = 'global',
        updated_at = ?
      WHERE id = ?
    `).run(now, existing.id);
  }

  return true;
}

/**
 * Migrate profile from one guild to another
 * Returns true if migration was successful
 */
export function migrateProfileToGuild(userId: number, fromGuildId: string, toGuildId: string): boolean {
  const db = getDb();
  const now = Date.now();

  const existing = getProfileByScope(userId, fromGuildId, false);
  if (!existing) {
    return false;
  }

  // Check if target guild profile already exists
  const targetProfile = getProfileByScope(userId, toGuildId, false);
  if (targetProfile) {
    // Merge: update target profile with source data
    db.prepare(`
      UPDATE user_profiles SET
        summary = COALESCE(?, summary),
        personality = COALESCE(?, personality),
        interests = COALESCE(?, interests),
        facts = COALESCE(?, facts),
        messages_analyzed = messages_analyzed + ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      existing.summary,
      existing.personality,
      existing.interests,
      existing.facts,
      existing.messages_analyzed,
      now,
      targetProfile.id,
    );

    // Delete the source profile
    db.prepare(`DELETE FROM user_profiles WHERE id = ?`).run(existing.id);
  } else {
    // Move to new guild
    db.prepare(`
      UPDATE user_profiles SET
        guild_id = ?,
        updated_at = ?
      WHERE id = ?
    `).run(toGuildId, now, existing.id);
  }

  return true;
}

/**
 * Check if a guild-specific profile exists for migration
 */
export function hasGuildProfile(userId: number, guildId: string): boolean {
  const profile = getProfileByScope(userId, guildId, false);
  return profile !== null;
}

/**
 * Check if a global profile exists
 */
export function hasGlobalProfile(userId: number): boolean {
  const profile = getProfileByScope(userId, null, true);
  return profile !== null;
}
