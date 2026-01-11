/**
 * Reminders Repository
 *
 * CRUD operations for the reminders table.
 */

import { getDb } from './client';

export interface Reminder {
  id: number;
  user_id: number;
  guild_id: string | null;
  channel_id: string | null;
  platform: string;
  message: string;
  trigger_at: number;
  created_at: number;
  delivered_at: number | null;
  cancelled_at: number | null;
  repeat_interval: 'daily' | 'weekly' | 'monthly' | null;
  repeat_end_at: number | null;
  snooze_count: number;
  original_reminder_id: number | null;
  source_message_id: string | null;
}

export interface CreateReminderInput {
  userId: number;
  guildId?: string;
  channelId?: string;
  platform: string;
  message: string;
  triggerAt: number; // Unix timestamp UTC
  repeatInterval?: 'daily' | 'weekly' | 'monthly';
  repeatEndAt?: number;
  originalReminderId?: number; // For snoozed reminders
  snoozeCount?: number;
  sourceMessageId?: string; // Original message that triggered the reminder
}

/**
 * Create a new reminder
 */
export function createReminder(input: CreateReminderInput): number {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO reminders (
      user_id, guild_id, channel_id, platform, message, 
      trigger_at, repeat_interval, repeat_end_at,
      original_reminder_id, snooze_count, source_message_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    input.userId,
    input.guildId ?? null,
    input.channelId ?? null,
    input.platform,
    input.message,
    input.triggerAt,
    input.repeatInterval ?? null,
    input.repeatEndAt ?? null,
    input.originalReminderId ?? null,
    input.snoozeCount ?? 0,
    input.sourceMessageId ?? null,
  );

  return Number(result.lastInsertRowid);
}

/**
 * Get a reminder by ID
 */
export function getReminder(id: number): Reminder | null {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM reminders WHERE id = ?');
  return stmt.get(id) as Reminder | null;
}

/**
 * Get all pending reminders for a user
 */
export function getUserPendingReminders(userId: number): Reminder[] {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM reminders 
    WHERE user_id = ? 
      AND delivered_at IS NULL 
      AND cancelled_at IS NULL
    ORDER BY trigger_at ASC
  `);
  return stmt.all(userId) as Reminder[];
}

/**
 * Get all due reminders (ready to be delivered)
 */
export function getDueReminders(): Reminder[] {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const stmt = db.prepare(`
    SELECT * FROM reminders 
    WHERE trigger_at <= ? 
      AND delivered_at IS NULL 
      AND cancelled_at IS NULL
    ORDER BY trigger_at ASC
  `);
  return stmt.all(now) as Reminder[];
}

/**
 * Mark a reminder as delivered
 */
export function markReminderDelivered(id: number): void {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const stmt = db.prepare('UPDATE reminders SET delivered_at = ? WHERE id = ?');
  stmt.run(now, id);
}

/**
 * Cancel a reminder
 */
export function cancelReminder(id: number): boolean {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const stmt = db.prepare(`
    UPDATE reminders 
    SET cancelled_at = ? 
    WHERE id = ? 
      AND delivered_at IS NULL 
      AND cancelled_at IS NULL
  `);
  const result = stmt.run(now, id);
  return result.changes > 0;
}

/**
 * Cancel a reminder by searching message text for a user
 */
export function cancelReminderByText(userId: number, searchText: string): Reminder | null {
  const db = getDb();

  // Find the reminder first
  const findStmt = db.prepare(`
    SELECT * FROM reminders 
    WHERE user_id = ? 
      AND message LIKE ? 
      AND delivered_at IS NULL 
      AND cancelled_at IS NULL
    ORDER BY trigger_at ASC
    LIMIT 1
  `);
  const reminder = findStmt.get(userId, `%${searchText}%`) as Reminder | null;

  if (reminder) {
    cancelReminder(reminder.id);
  }

  return reminder;
}

/**
 * Create next occurrence for a recurring reminder
 */
export function createNextOccurrence(reminder: Reminder): number | null {
  if (!reminder.repeat_interval) return null;

  // Calculate next trigger time
  let nextTrigger = reminder.trigger_at;
  const now = Math.floor(Date.now() / 1000);

  switch (reminder.repeat_interval) {
    case 'daily':
      nextTrigger += 24 * 60 * 60; // +1 day
      break;
    case 'weekly':
      nextTrigger += 7 * 24 * 60 * 60; // +7 days
      break;
    case 'monthly': {
      // Add ~30 days (proper month handling would need date objects)
      const date = new Date(reminder.trigger_at * 1000);
      date.setMonth(date.getMonth() + 1);
      nextTrigger = Math.floor(date.getTime() / 1000);
      break;
    }
  }

  // Check if past end date
  if (reminder.repeat_end_at && nextTrigger > reminder.repeat_end_at) {
    return null;
  }

  // Don't create if next trigger is in the past (catch up scenario)
  if (nextTrigger <= now) {
    return null;
  }

  return createReminder({
    userId: reminder.user_id,
    guildId: reminder.guild_id ?? undefined,
    channelId: reminder.channel_id ?? undefined,
    platform: reminder.platform,
    message: reminder.message,
    triggerAt: nextTrigger,
    repeatInterval: reminder.repeat_interval,
    repeatEndAt: reminder.repeat_end_at ?? undefined,
  });
}

/**
 * Create a snoozed reminder
 */
export function snoozeReminder(originalId: number, snoozeSeconds: number): number | null {
  const original = getReminder(originalId);
  if (!original) return null;

  const now = Math.floor(Date.now() / 1000);
  const newTrigger = now + snoozeSeconds;

  return createReminder({
    userId: original.user_id,
    guildId: original.guild_id ?? undefined,
    channelId: original.channel_id ?? undefined,
    platform: original.platform,
    message: original.message,
    triggerAt: newTrigger,
    originalReminderId: original.original_reminder_id ?? original.id,
    snoozeCount: original.snooze_count + 1,
  });
}

/**
 * Get reminder count for a user
 */
export function getUserReminderCount(userId: number): number {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT COUNT(*) as count FROM reminders 
    WHERE user_id = ? 
      AND delivered_at IS NULL 
      AND cancelled_at IS NULL
  `);
  const result = stmt.get(userId) as { count: number };
  return result.count;
}
