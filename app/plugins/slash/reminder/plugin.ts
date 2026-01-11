/**
 * /reminder slash command plugin
 *
 * Provides explicit reminder management via slash commands.
 */

import type { AutocompleteRequest, CommandHandlerPlugin, CommandInvocation, PluginContext } from '@core';
import { registerCommand, unregisterCommand } from '@core';
import {
  cancelReminder,
  createReminder,
  getReminder,
  getUserByPlatformId,
  getUserPendingReminders,
  getUserReminderCount,
} from '@core/database';
import { reminderCommand } from './command';

// Time parsing regex patterns
const RELATIVE_TIME_REGEX = /^(\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|week|weeks)$/i;
const ABSOLUTE_TIME_REGEX = /^(\d{4})-(\d{2})-(\d{2})[\sT](\d{2}):(\d{2})(?::(\d{2}))?$/;

export class ReminderCommandPlugin implements CommandHandlerPlugin {
  readonly id = 'reminder';
  readonly type = 'command' as const;
  readonly commands = ['reminder'];

  private context?: PluginContext;

  async load(context: PluginContext): Promise<void> {
    this.context = context;

    // Register command definition
    registerCommand(reminderCommand, this.id);

    // Wire up event handlers
    context.eventBus.on('command:received', this.handleCommand.bind(this));
    context.eventBus.on('command:autocomplete', this.handleAutocomplete.bind(this));

    context.logger.info('ReminderCommandPlugin loaded');
  }

  async unload(): Promise<void> {
    unregisterCommand('reminder');
    this.context?.logger.info('ReminderCommandPlugin unloaded');
    this.context = undefined;
  }

  private handleCommand = async (invocation: CommandInvocation): Promise<void> => {
    if (invocation.commandName !== 'reminder') return;

    const subcommand = invocation.subcommand;

    switch (subcommand) {
      case 'set':
        await this.handleSet(invocation);
        break;
      case 'list':
        await this.handleList(invocation);
        break;
      case 'cancel':
        await this.handleCancel(invocation);
        break;
      default:
        await invocation.reply({
          content: '❌ Unknown subcommand',
          ephemeral: true,
        });
    }
  };

  private handleAutocomplete = async (request: AutocompleteRequest): Promise<void> => {
    if (request.commandName !== 'reminder') return;

    if (request.subcommand === 'cancel' && request.focusedOption.name === 'id') {
      await this.autocompleteReminderId(request);
    } else if (request.subcommand === 'set' && request.focusedOption.name === 'timezone') {
      await this.autocompleteTimezone(request);
    }
  };

  private async autocompleteReminderId(request: AutocompleteRequest): Promise<void> {
    const user = getUserByPlatformId('discord', request.user.id);
    if (!user) {
      await request.respond([]);
      return;
    }

    const reminders = getUserPendingReminders(user.id);
    const input = String(request.focusedOption.value || '').toLowerCase();

    // Filter and map reminders to autocomplete choices
    const choices = reminders
      .filter((r) => {
        // Filter by ID or message content matching input
        if (!input) return true;
        return String(r.id).includes(input) || r.message.toLowerCase().includes(input);
      })
      .slice(0, 25) // Discord limit
      .map((r) => {
        const timeStr = new Date(r.trigger_at * 1000).toLocaleString('en-US', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
        const msgPreview = r.message.length > 40 ? `${r.message.substring(0, 40)}...` : r.message;
        return {
          name: `#${r.id} - ${msgPreview} (${timeStr})`.substring(0, 100),
          value: r.id,
        };
      });

    await request.respond(choices);
  }

  private async autocompleteTimezone(request: AutocompleteRequest): Promise<void> {
    const input = String(request.focusedOption.value || '').toLowerCase();

    const timezones = [
      { name: 'UTC (GMT+0)', value: '+0' },
      { name: 'London (GMT+0)', value: '+0' },
      { name: 'Paris, Berlin, Copenhagen (GMT+1)', value: '+1' },
      { name: 'Helsinki, Athens (GMT+2)', value: '+2' },
      { name: 'Moscow (GMT+3)', value: '+3' },
      { name: 'Dubai (GMT+4)', value: '+4' },
      { name: 'Mumbai, Delhi (GMT+5:30)', value: '+5:30' },
      { name: 'Bangkok, Jakarta (GMT+7)', value: '+7' },
      { name: 'Singapore, Hong Kong (GMT+8)', value: '+8' },
      { name: 'Tokyo, Seoul (GMT+9)', value: '+9' },
      { name: 'Sydney (GMT+10)', value: '+10' },
      { name: 'Auckland (GMT+12)', value: '+12' },
      { name: 'New York, Toronto (GMT-5)', value: '-5' },
      { name: 'Chicago, Dallas (GMT-6)', value: '-6' },
      { name: 'Denver, Phoenix (GMT-7)', value: '-7' },
      { name: 'Los Angeles, Seattle (GMT-8)', value: '-8' },
      { name: 'Alaska (GMT-9)', value: '-9' },
      { name: 'Hawaii (GMT-10)', value: '-10' },
      { name: 'São Paulo (GMT-3)', value: '-3' },
      { name: 'Buenos Aires (GMT-3)', value: '-3' },
    ];

    const choices = timezones
      .filter((tz) => {
        if (!input) return true;
        return tz.name.toLowerCase().includes(input) || tz.value.includes(input);
      })
      .slice(0, 25);

    await request.respond(choices);
  }

  private async handleSet(invocation: CommandInvocation): Promise<void> {
    const message = invocation.args.message as string;
    const timeInput = invocation.args.time as string;
    const repeat = invocation.args.repeat as 'daily' | 'weekly' | 'monthly' | undefined;
    const timezone = invocation.args.timezone as string | undefined;

    // Get user from database
    const user = getUserByPlatformId('discord', invocation.user.id);
    if (!user) {
      await invocation.reply({
        content: '❌ Could not find your user record. Please send a message first so the bot can register you.',
        ephemeral: true,
      });
      return;
    }

    // Check reminder limit
    const existingCount = getUserReminderCount(user.id);
    if (existingCount >= 50) {
      await invocation.reply({
        content:
          '❌ You have reached the maximum of 50 pending reminders. Use `/reminder list` and `/reminder cancel` to manage them.',
        ephemeral: true,
      });
      return;
    }

    // Parse the time
    const triggerAt = this.parseTime(timeInput, timezone);
    if (!triggerAt) {
      await invocation.reply({
        content: `❌ Could not parse time: \`${timeInput}\`\n\nExamples:\n• \`30m\` - 30 minutes\n• \`2h\` - 2 hours\n• \`1d\` - 1 day\n• \`2025-01-15 14:00\` - specific date/time (UTC by default)`,
        ephemeral: true,
      });
      return;
    }

    const now = Math.floor(Date.now() / 1000);
    if (triggerAt <= now) {
      await invocation.reply({
        content: '❌ Cannot create a reminder in the past. Please specify a future time.',
        ephemeral: true,
      });
      return;
    }

    // Create the reminder
    const reminderId = createReminder({
      userId: user.id,
      guildId: invocation.guildId,
      channelId: invocation.channel.id,
      platform: 'discord',
      message,
      triggerAt,
      repeatInterval: repeat,
    });

    this.context?.logger.info('[Reminder] Created via slash command', {
      reminderId,
      userId: user.id,
      triggerAt,
      repeat,
    });

    // Build response
    let response = `✅ **Reminder set!**\n\n`;
    response += `📝 ${message}\n`;
    response += `⏰ <t:${triggerAt}:F> (<t:${triggerAt}:R>)\n`;
    if (repeat) {
      response += `🔄 Repeats ${repeat}\n`;
    }
    response += `\n_I'll send you a DM when it's time!_`;

    await invocation.reply({ content: response, ephemeral: true });
  }

  private async handleList(invocation: CommandInvocation): Promise<void> {
    const user = getUserByPlatformId('discord', invocation.user.id);
    if (!user) {
      await invocation.reply({
        content: '❌ Could not find your user record.',
        ephemeral: true,
      });
      return;
    }

    const reminders = getUserPendingReminders(user.id);

    if (reminders.length === 0) {
      await invocation.reply({
        content: '📭 You have no pending reminders.\n\nUse `/reminder set` to create one!',
        ephemeral: true,
      });
      return;
    }

    let response = `📋 **Your Reminders** (${reminders.length})\n\n`;

    for (const r of reminders.slice(0, 10)) {
      const repeatIcon = r.repeat_interval ? '🔄' : '';
      const snoozeInfo = r.snooze_count > 0 ? ` (snoozed ${r.snooze_count}x)` : '';
      response += `**#${r.id}** ${repeatIcon} ${r.message.substring(0, 50)}${r.message.length > 50 ? '...' : ''}${snoozeInfo}\n`;
      response += `└ <t:${r.trigger_at}:F> (<t:${r.trigger_at}:R>)\n\n`;
    }

    if (reminders.length > 10) {
      response += `_...and ${reminders.length - 10} more_\n`;
    }

    response += `\n_Use \`/reminder cancel id:<number>\` to cancel a reminder._`;

    await invocation.reply({ content: response, ephemeral: true });
  }

  private async handleCancel(invocation: CommandInvocation): Promise<void> {
    const reminderId = invocation.args.id as number;

    const user = getUserByPlatformId('discord', invocation.user.id);
    if (!user) {
      await invocation.reply({
        content: '❌ Could not find your user record.',
        ephemeral: true,
      });
      return;
    }

    // Get the reminder to verify ownership
    const reminder = getReminder(reminderId);
    if (!reminder) {
      await invocation.reply({
        content: `❌ Could not find reminder #${reminderId}`,
        ephemeral: true,
      });
      return;
    }

    if (reminder.user_id !== user.id) {
      await invocation.reply({
        content: '❌ You can only cancel your own reminders.',
        ephemeral: true,
      });
      return;
    }

    if (reminder.delivered_at || reminder.cancelled_at) {
      await invocation.reply({
        content: '❌ This reminder has already been delivered or cancelled.',
        ephemeral: true,
      });
      return;
    }

    const success = cancelReminder(reminderId);
    if (!success) {
      await invocation.reply({
        content: '❌ Failed to cancel reminder.',
        ephemeral: true,
      });
      return;
    }

    this.context?.logger.info('[Reminder] Cancelled via slash command', {
      reminderId,
      userId: user.id,
    });

    await invocation.reply({
      content: `✅ Cancelled reminder #${reminderId}: "${reminder.message.substring(0, 50)}${reminder.message.length > 50 ? '...' : ''}"`,
      ephemeral: true,
    });
  }

  /**
   * Parse time input string to Unix timestamp
   */
  private parseTime(input: string, timezone?: string): number | null {
    const now = Date.now();

    // Try relative time first (30m, 2h, 1d, etc.)
    const relativeMatch = input.match(RELATIVE_TIME_REGEX);
    if (relativeMatch) {
      const amount = parseInt(relativeMatch[1] ?? '0', 10);
      const unit = (relativeMatch[2] ?? 'm').toLowerCase();

      let milliseconds = 0;
      if (unit.startsWith('m')) {
        milliseconds = amount * 60 * 1000;
      } else if (unit.startsWith('h')) {
        milliseconds = amount * 60 * 60 * 1000;
      } else if (unit.startsWith('d')) {
        milliseconds = amount * 24 * 60 * 60 * 1000;
      } else if (unit.startsWith('w')) {
        milliseconds = amount * 7 * 24 * 60 * 60 * 1000;
      }

      return Math.floor((now + milliseconds) / 1000);
    }

    // Try absolute time (2025-01-15 14:00)
    const absoluteMatch = input.match(ABSOLUTE_TIME_REGEX);
    if (absoluteMatch) {
      const year = absoluteMatch[1] ?? '2025';
      const month = absoluteMatch[2] ?? '01';
      const day = absoluteMatch[3] ?? '01';
      const hour = absoluteMatch[4] ?? '00';
      const minute = absoluteMatch[5] ?? '00';
      const second = absoluteMatch[6] ?? '00';

      // Parse timezone offset
      let offsetMs = 0;
      if (timezone) {
        const tzMatch = timezone.match(/^([+-])?(\d{1,2})(?::(\d{2}))?$/);
        if (tzMatch) {
          const sign = tzMatch[1] === '-' ? 1 : -1; // Invert because we're converting TO UTC
          const hours = parseInt(tzMatch[2] ?? '0', 10);
          const minutes = parseInt(tzMatch[3] ?? '0', 10);
          offsetMs = sign * (hours * 60 + minutes) * 60 * 1000;
        }
      }

      const date = new Date(
        Date.UTC(
          parseInt(year, 10),
          parseInt(month, 10) - 1,
          parseInt(day, 10),
          parseInt(hour, 10),
          parseInt(minute, 10),
          parseInt(second, 10),
        ),
      );

      return Math.floor((date.getTime() + offsetMs) / 1000);
    }

    return null;
  }
}

export default ReminderCommandPlugin;
