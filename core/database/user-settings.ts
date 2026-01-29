/**
 * User Settings Repository - Manages per-user settings in the database
 */

import { getDb } from './client';

export type UserSettingKey = 'openrouter_api_key' | 'default_chat_model' | 'image_models' | 'image_webhooks';

export type WebhookType = 'discord' | 'generic';

export interface WebhookConfig {
  id: string;
  name: string;
  url: string;
  type: WebhookType;
  categories: string[];
  isDefault?: boolean;
}

interface StoredUserSetting {
  id: number;
  user_id: number;
  setting_key: string;
  setting_value: string;
  created_at: number;
  updated_at: number;
}

// =============================================================================
// Generic CRUD Functions
// =============================================================================

/**
 * Get a setting by key, parsing the JSON value
 */
export function getUserSetting<T>(userId: number, key: UserSettingKey): T | null {
  const db = getDb();

  const row = db
    .prepare<StoredUserSetting, [number, string]>(`
      SELECT * FROM user_settings
      WHERE user_id = ? AND setting_key = ?
    `)
    .get(userId, key);

  if (!row) return null;

  try {
    return JSON.parse(row.setting_value) as T;
  } catch {
    return null;
  }
}

/**
 * Set a setting, JSON stringifying the value
 */
export function setUserSetting<T>(userId: number, key: UserSettingKey, value: T): void {
  const db = getDb();
  const now = Date.now();
  const jsonValue = JSON.stringify(value);

  // Use INSERT OR REPLACE (upsert)
  db.prepare(`
    INSERT INTO user_settings (user_id, setting_key, setting_value, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (user_id, setting_key) DO UPDATE SET
      setting_value = excluded.setting_value,
      updated_at = excluded.updated_at
  `).run(userId, key, jsonValue, now, now);
}

/**
 * Delete a setting
 */
export function deleteUserSetting(userId: number, key: UserSettingKey): void {
  const db = getDb();

  db.prepare(`
    DELETE FROM user_settings
    WHERE user_id = ? AND setting_key = ?
  `).run(userId, key);
}

/**
 * Get all settings for a user
 */
export function getAllUserSettings(userId: number): Record<string, unknown> {
  const db = getDb();

  const rows = db
    .prepare<StoredUserSetting, [number]>(`
      SELECT * FROM user_settings
      WHERE user_id = ?
    `)
    .all(userId);

  const settings: Record<string, unknown> = {};

  for (const row of rows) {
    try {
      settings[row.setting_key] = JSON.parse(row.setting_value);
    } catch {
      settings[row.setting_key] = row.setting_value;
    }
  }

  return settings;
}

// =============================================================================
// Typed Helper Functions - API Key
// =============================================================================

/**
 * Get user's OpenRouter API key
 */
export function getUserApiKey(userId: number): string | null {
  return getUserSetting<string>(userId, 'openrouter_api_key');
}

/**
 * Set user's OpenRouter API key
 */
export function setUserApiKey(userId: number, key: string): void {
  setUserSetting(userId, 'openrouter_api_key', key);
}

/**
 * Delete user's OpenRouter API key
 */
export function deleteUserApiKey(userId: number): void {
  deleteUserSetting(userId, 'openrouter_api_key');
}

// =============================================================================
// Typed Helper Functions - Default Model
// =============================================================================

/**
 * Get user's default chat model
 */
export function getUserDefaultModel(userId: number): string | null {
  return getUserSetting<string>(userId, 'default_chat_model');
}

/**
 * Set user's default chat model
 */
export function setUserDefaultModel(userId: number, model: string): void {
  setUserSetting(userId, 'default_chat_model', model);
}

// =============================================================================
// Typed Helper Functions - Image Models
// =============================================================================

/**
 * Get user's image models list
 */
export function getUserImageModels(userId: number): string[] | null {
  return getUserSetting<string[]>(userId, 'image_models');
}

/**
 * Set user's image models list
 */
export function setUserImageModels(userId: number, models: string[]): void {
  setUserSetting(userId, 'image_models', models);
}

// =============================================================================
// Typed Helper Functions - Webhooks
// =============================================================================

/**
 * Get user's webhooks list
 */
export function getUserWebhooks(userId: number): WebhookConfig[] {
  return getUserSetting<WebhookConfig[]>(userId, 'image_webhooks') ?? [];
}

/**
 * Set user's webhooks list
 */
export function setUserWebhooks(userId: number, webhooks: WebhookConfig[]): void {
  setUserSetting(userId, 'image_webhooks', webhooks);
}

/**
 * Add a webhook to user's existing list
 */
export function addUserWebhook(userId: number, webhook: WebhookConfig): void {
  const webhooks = getUserWebhooks(userId);
  webhooks.push(webhook);
  setUserWebhooks(userId, webhooks);
}

/**
 * Remove a webhook by ID from user's list
 */
export function removeUserWebhook(userId: number, webhookId: string): void {
  const webhooks = getUserWebhooks(userId);
  const filtered = webhooks.filter((w) => w.id !== webhookId);
  setUserWebhooks(userId, filtered);
}

/**
 * Find a webhook matching a category
 */
export function getWebhookByCategory(userId: number, category: string): WebhookConfig | null {
  const webhooks = getUserWebhooks(userId);

  for (const webhook of webhooks) {
    if (webhook.categories.includes(category)) {
      return webhook;
    }
  }

  return null;
}

/**
 * Get the default webhook if set
 */
export function getDefaultWebhook(userId: number): WebhookConfig | null {
  const webhooks = getUserWebhooks(userId);

  for (const webhook of webhooks) {
    if (webhook.isDefault) {
      return webhook;
    }
  }

  return null;
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Delete all settings for a user
 */
export function clearAllUserSettings(userId: number): void {
  const db = getDb();

  db.prepare(`
    DELETE FROM user_settings
    WHERE user_id = ?
  `).run(userId);
}
