/**
 * User Roles Repository
 *
 * Caches user role information per guild with automatic refresh.
 * Resolves raw role IDs to friendly group names from config.
 */

import { type BotConfig, getBotConfig } from '../config';
import type { Platform } from '../types';
import { getDb } from './client';

/** Cache TTL in milliseconds (24 hours) */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface UserRoles {
  id: number;
  userId: number;
  guildId: string;
  platform: string;
  roleIds: string[];
  resolvedGroups: string[];
  updatedAt: number;
}

export interface UserRolesInput {
  userId: number;
  guildId: string;
  platform: Platform;
  roleIds: string[];
}

/**
 * Get cached user roles, or null if not found or stale
 */
export function getCachedUserRoles(userId: number, guildId: string, platform: Platform): UserRoles | null {
  const db = getDb();

  const row = db
    .query<
      {
        id: number;
        user_id: number;
        guild_id: string;
        platform: string;
        role_ids: string;
        resolved_groups: string;
        updated_at: number;
      },
      [number, string, string]
    >('SELECT * FROM user_roles WHERE user_id = ? AND guild_id = ? AND platform = ?')
    .get(userId, guildId, platform);

  if (!row) return null;

  // Check if stale
  const age = Date.now() - row.updated_at;
  if (age > CACHE_TTL_MS) return null;

  return {
    id: row.id,
    userId: row.user_id,
    guildId: row.guild_id,
    platform: row.platform,
    roleIds: JSON.parse(row.role_ids),
    resolvedGroups: JSON.parse(row.resolved_groups),
    updatedAt: row.updated_at,
  };
}

/**
 * Resolve role IDs to group names from config
 */
export function resolveRolesToGroups(roleIds: string[], platform: Platform, config?: BotConfig): string[] {
  const cfg = config ?? getBotConfig();
  const groups: string[] = [];

  if (!cfg.accessGroups || roleIds.length === 0) {
    return ['everyone'];
  }

  // Check each access group
  for (const [groupName, platformAccess] of Object.entries(cfg.accessGroups)) {
    const platformRoles = platformAccess[platform as keyof typeof platformAccess];
    if (!platformRoles) continue;

    // Check if user has any role that matches this group
    const hasMatch = roleIds.some((roleId) => platformRoles.includes(roleId));
    if (hasMatch) {
      groups.push(groupName);
    }
  }

  // If no groups matched, return 'everyone'
  return groups.length > 0 ? groups : ['everyone'];
}

/**
 * Update or insert user roles cache
 */
export function upsertUserRoles(input: UserRolesInput, config?: BotConfig): UserRoles {
  const db = getDb();
  const now = Date.now();

  // Resolve groups from role IDs
  const resolvedGroups = resolveRolesToGroups(input.roleIds, input.platform, config);

  const roleIdsJson = JSON.stringify(input.roleIds);
  const resolvedGroupsJson = JSON.stringify(resolvedGroups);

  // Upsert
  db.run(
    `INSERT INTO user_roles (user_id, guild_id, platform, role_ids, resolved_groups, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, guild_id, platform) DO UPDATE SET
       role_ids = excluded.role_ids,
       resolved_groups = excluded.resolved_groups,
       updated_at = excluded.updated_at`,
    [input.userId, input.guildId, input.platform, roleIdsJson, resolvedGroupsJson, now],
  );

  return {
    id: 0, // Not important for return value
    userId: input.userId,
    guildId: input.guildId,
    platform: input.platform,
    roleIds: input.roleIds,
    resolvedGroups,
    updatedAt: now,
  };
}

/**
 * Get or refresh user roles
 *
 * Returns cached roles if fresh, otherwise updates cache with new role IDs.
 */
export function getOrRefreshUserRoles(input: UserRolesInput, config?: BotConfig): UserRoles {
  // Check cache first
  const cached = getCachedUserRoles(input.userId, input.guildId, input.platform);

  if (cached) {
    // Cache is fresh - but check if role IDs changed
    const currentRoleIds = JSON.stringify(input.roleIds.sort());
    const cachedRoleIds = JSON.stringify(cached.roleIds.sort());

    if (currentRoleIds === cachedRoleIds) {
      return cached;
    }
    // Role IDs changed, refresh
  }

  // Cache miss or stale or roles changed - refresh
  return upsertUserRoles(input, config);
}

/**
 * Format groups for logging
 */
export function formatGroupsForLog(groups: string[]): string {
  if (groups.length === 0 || (groups.length === 1 && groups[0] === 'everyone')) {
    return 'everyone';
  }
  return groups.join(', ');
}
