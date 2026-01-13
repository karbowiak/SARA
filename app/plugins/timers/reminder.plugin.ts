/**
 * Reminder Timer Plugin
 *
 * Checks for due reminders every 5 seconds and delivers them via DM.
 * Handles recurring reminders and provides snooze buttons.
 * Includes AI-generated commentary with each reminder.
 */

import type {
  BotButton,
  ButtonInteraction,
  EventBus,
  Logger,
  PluginContext,
  TimerConfig,
  TimerHandlerPlugin,
} from '@core';
import { getBotConfig } from '@core';
import {
  createNextOccurrence,
  getDb,
  getDueReminders,
  getReminder,
  markReminderDelivered,
  type Reminder,
  snoozeReminder,
} from '@core/database';
import { LLMClient } from '@core/llm-client';

// Snooze durations in seconds
const SNOOZE_10M = 10 * 60;
const SNOOZE_1H = 60 * 60;
const SNOOZE_TOMORROW = 24 * 60 * 60;

export class ReminderTimerPlugin implements TimerHandlerPlugin {
  readonly id = 'reminder-timer';
  readonly type = 'timer' as const;

  readonly timerConfig: TimerConfig = {
    intervalMs: 5 * 1000, // Check every 5 seconds
    runImmediately: false, // Don't run on startup
    maxConcurrent: 1, // Only one check at a time
  };

  private context?: PluginContext;
  private logger?: Logger;
  private eventBus?: EventBus;

  async load(context: PluginContext): Promise<void> {
    this.context = context;
    this.logger = context.logger;
    this.eventBus = context.eventBus;

    // Listen for snooze button interactions
    context.eventBus.on('interaction:button', this.handleSnoozeButton.bind(this));

    context.logger.info('ReminderTimerPlugin loaded');
  }

  async unload(): Promise<void> {
    this.context?.logger.info('ReminderTimerPlugin unloaded');
    this.context = undefined;
    this.logger = undefined;
    this.eventBus = undefined;
  }

  async tick(context: PluginContext): Promise<void> {
    const dueReminders = getDueReminders();

    if (dueReminders.length === 0) return;

    context.logger.debug(`[Reminder] Found ${dueReminders.length} due reminder(s)`);

    for (const reminder of dueReminders) {
      await this.deliverReminder(reminder, context);
    }
  }

  private async deliverReminder(reminder: Reminder, context: PluginContext): Promise<void> {
    // Mark as delivered FIRST to prevent re-delivery on next tick
    markReminderDelivered(reminder.id);

    try {
      // Get user's platform ID for DM
      const user = this.getUserPlatformId(reminder.user_id, reminder.platform);
      if (!user) {
        context.logger.warn('[Reminder] Could not find user for reminder', { reminderId: reminder.id });
        return;
      }

      // Generate AI commentary
      const aiComment = await this.generateAIComment(reminder, user.username, context);

      // Build the DM content with AI commentary
      const content = this.buildReminderMessage(reminder, aiComment);
      const components = this.buildSnoozeButtons(reminder.id);

      // Send DM via eventBus
      this.eventBus?.emit('dm:send', {
        platform: reminder.platform as 'discord' | 'slack',
        userId: user.platformUserId,
        message: {
          content,
          components,
        },
      });

      // Create next occurrence if recurring
      if (reminder.repeat_interval) {
        const nextId = createNextOccurrence(reminder);
        if (nextId) {
          context.logger.debug('[Reminder] Created next occurrence', {
            originalId: reminder.id,
            nextId,
            interval: reminder.repeat_interval,
          });
        }
      }

      context.logger.info('[Reminder] Delivered', {
        reminderId: reminder.id,
        userId: reminder.user_id,
        message: reminder.message.substring(0, 50),
      });
    } catch (error) {
      context.logger.error('[Reminder] Failed to deliver', {
        reminderId: reminder.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Generate a brief AI comment about the reminder
   */
  private async generateAIComment(
    reminder: Reminder,
    username: string,
    context: PluginContext,
  ): Promise<string | null> {
    try {
      const config = getBotConfig();
      const llm = new LLMClient({
        apiKey: config.tokens.openrouter,
        defaultModel: config.ai?.defaultModel,
        defaultTemperature: 0.8,
        defaultMaxTokens: 150,
      });

      const botName = config.bot.identity ?? config.bot.name;
      const timeSinceSet = Math.floor(Date.now() / 1000) - reminder.created_at;
      const timeDescription = this.formatDuration(timeSinceSet);

      const response = await llm.chat({
        messages: [
          {
            role: 'system',
            content: `You are ${botName}, a friendly Discord bot. Write a brief, casual one-liner (max 100 chars) to accompany a reminder notification. Be encouraging, playful, or add a relevant emoji. Don't repeat the reminder content. Match the tone to the reminder topic.`,
          },
          {
            role: 'user',
            content: `User "${username}" set a reminder ${timeDescription} ago: "${reminder.message}"

Write a short, friendly comment to go with this reminder (like "Time to get things done! 💪" or "Don't forget! 📝"). Keep it brief and relevant.`,
          },
        ],
      });

      return response.choices[0]?.message?.content?.trim() ?? null;
    } catch (error) {
      context.logger.debug('[Reminder] AI comment generation failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Format duration in human-readable form
   */
  private formatDuration(seconds: number): string {
    if (seconds < 60) return `${seconds} seconds`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours`;
    return `${Math.floor(seconds / 86400)} days`;
  }

  private getUserPlatformId(userId: number, platform: string): { platformUserId: string; username: string } | null {
    // Query users table to get platform user ID
    const db = getDb();
    const stmt = db.prepare('SELECT platform_user_id, username FROM users WHERE id = ? AND platform = ?');
    const result = stmt.get(userId, platform) as { platform_user_id: string; username: string } | undefined;

    if (!result) return null;
    return { platformUserId: result.platform_user_id, username: result.username };
  }

  private buildReminderMessage(reminder: Reminder, aiComment?: string | null): string {
    const lines: string[] = [];

    // Main reminder
    lines.push(`⏰ **Reminder:** ${reminder.message}`);
    lines.push('');

    // AI commentary (if available)
    if (aiComment) {
      lines.push(`💬 ${aiComment}`);
      lines.push('');
    }

    // Message link (Discord format)
    if (reminder.source_message_id && reminder.guild_id && reminder.channel_id) {
      const messageLink = `https://discord.com/channels/${reminder.guild_id}/${reminder.channel_id}/${reminder.source_message_id}`;
      lines.push(`🔗 [Jump to original message](${messageLink})`);
      lines.push('');
    }

    // Context - when it was set
    lines.push(`📍 Set <t:${reminder.created_at}:R>`);

    // Snooze count
    if (reminder.snooze_count > 0) {
      lines.push(`🔁 Snoozed ${reminder.snooze_count} time${reminder.snooze_count > 1 ? 's' : ''}`);
    }

    // Recurring indicator
    if (reminder.repeat_interval) {
      lines.push(`🔄 Repeats ${reminder.repeat_interval}`);
    }

    return lines.join('\n');
  }

  private buildSnoozeButtons(reminderId: number): BotButton[][] {
    // Return array of rows, each row is array of buttons
    return [
      [
        {
          type: 'button',
          style: 'secondary',
          label: '10m',
          emoji: '🔁',
          customId: `reminder_snooze_${reminderId}_${SNOOZE_10M}`,
        },
        {
          type: 'button',
          style: 'secondary',
          label: '1h',
          emoji: '🔁',
          customId: `reminder_snooze_${reminderId}_${SNOOZE_1H}`,
        },
        {
          type: 'button',
          style: 'secondary',
          label: 'Tomorrow',
          emoji: '🔁',
          customId: `reminder_snooze_${reminderId}_${SNOOZE_TOMORROW}`,
        },
        {
          type: 'button',
          style: 'success',
          label: 'Done',
          emoji: '✅',
          customId: `reminder_done_${reminderId}`,
        },
      ],
    ];
  }

  private async handleSnoozeButton(interaction: ButtonInteraction): Promise<void> {
    // Check if this is a reminder button
    if (!interaction.customId.startsWith('reminder_')) return;

    const parts = interaction.customId.split('_');

    if (parts[1] === 'done') {
      // Just acknowledge - reminder is already delivered
      await interaction.deferUpdate();
      return;
    }

    if (parts[1] === 'snooze') {
      const reminderId = parseInt(parts[2] ?? '0', 10);
      const snoozeSeconds = parseInt(parts[3] ?? '0', 10);

      if (Number.isNaN(reminderId) || Number.isNaN(snoozeSeconds) || reminderId === 0) {
        await interaction.reply({ content: '❌ Invalid snooze action.', ephemeral: true });
        return;
      }

      const original = getReminder(reminderId);
      if (!original) {
        await interaction.reply({ content: '❌ Could not find the original reminder.', ephemeral: true });
        return;
      }

      const newId = snoozeReminder(reminderId, snoozeSeconds);
      if (!newId) {
        await interaction.reply({ content: '❌ Failed to snooze reminder.', ephemeral: true });
        return;
      }

      // Calculate when it will trigger
      const newTriggerAt = Math.floor(Date.now() / 1000) + snoozeSeconds;

      await interaction.reply({
        content: `🔁 Snoozed! I'll remind you again <t:${newTriggerAt}:R>.`,
        ephemeral: true,
      });

      this.logger?.info('[Reminder] Snoozed', {
        originalId: reminderId,
        newId,
        snoozeSeconds,
      });
    }
  }
}

export default ReminderTimerPlugin;
