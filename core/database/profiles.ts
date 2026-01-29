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
 * Returns null if not found
 */
export function getProfile(userId: number, guildId: string): StoredProfile | null {
  const db = getDb();
  return (
    db
      .prepare<StoredProfile, [number, string]>(`
        SELECT * FROM user_profiles 
        WHERE user_id = ? AND guild_id = ?
      `)
      .get(userId, guildId) ?? null
  );
}

/**
 * Create or update a profile
 * Updates last_generated_at and updated_at timestamps
 */
export function upsertProfile(params: UpsertProfileParams): StoredProfile {
  const db = getDb();
  const now = Date.now();

  const existing = getProfile(params.userId, params.guildId);

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

    return getProfile(params.userId, params.guildId)!;
  }

  // Create new profile
  db.prepare(`
    INSERT INTO user_profiles (
      user_id, guild_id, summary, personality, interests, facts,
      opted_out, messages_analyzed, last_generated_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
  `).run(
    params.userId,
    params.guildId,
    params.summary ?? null,
    params.personality ?? null,
    params.interests ?? null,
    params.facts ?? null,
    params.messagesAnalyzed ?? 0,
    now,
    now,
    now,
  );

  return getProfile(params.userId, params.guildId)!;
}

/**
 * Set the opted_out flag for a user
 * Creates a minimal profile record if none exists
 */
export function setOptOut(userId: number, guildId: string, optedOut: boolean): void {
  const db = getDb();
  const now = Date.now();

  const existing = getProfile(userId, guildId);

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
        opted_out, messages_analyzed, last_generated_at, created_at, updated_at
      ) VALUES (?, ?, NULL, NULL, NULL, NULL, ?, 0, NULL, ?, ?)
    `).run(userId, guildId, optedOut ? 1 : 0, now, now);
  }
}

/**
 * Returns true if user has opted out, false otherwise
 * Returns false if no profile exists (default is opted-in)
 */
export function getOptOutStatus(userId: number, guildId: string): boolean {
  const profile = getProfile(userId, guildId);
  return profile?.opted_out === 1;
}

/**
 * Check if user can generate a profile (rate limit: 24 hours)
 * Returns canGenerate: true if no profile exists or last_generated_at > 24h ago
 * Returns nextAvailable date if rate limited
 */
export function canGenerateProfile(userId: number, guildId: string): { canGenerate: boolean; nextAvailable?: Date } {
  const profile = getProfile(userId, guildId);

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
