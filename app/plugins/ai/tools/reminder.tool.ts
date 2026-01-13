/**
 * Reminder Tool
 *
 * Allows users to create, list, and cancel reminders via natural language.
 * Reminders are delivered via DM when they trigger.
 */

import type { Tool, ToolExecutionContext, ToolMetadata, ToolResult, ToolSchema } from '@core';
import {
  cancelReminder,
  cancelReminderByText,
  createReminder,
  getUserByPlatformId,
  getUserPendingReminders,
  getUserReminderCount,
  type Reminder,
} from '@core/database';

export class ReminderTool implements Tool {
  readonly metadata: ToolMetadata = {
    name: 'reminder',
    description: 'Create, list, or cancel reminders that are delivered via DM',
    version: '1.0.0',
    author: 'system',
    keywords: ['reminder', 'remind', 'alarm', 'schedule', 'timer'],
    category: 'utility',
    priority: 5,
  };

  readonly schema: ToolSchema = {
    type: 'function',
    name: 'reminder',
    description: `Manage reminders for users. Reminders are delivered via DM when they trigger.

ACTIONS:
- create: Create a new reminder. Requires message and trigger_at_utc.
- list: List all pending reminders for the user.
- cancel: Cancel a reminder by ID or by searching the message text.

TIME HANDLING:
- For relative times ("in 2 hours", "in 30 minutes"), calculate the UTC timestamp.
- For absolute times ("at 3pm", "Monday at noon"), ASSUME UTC timezone.
- If the user specifies a timezone-ambiguous time, mention that UTC is assumed.
- Always confirm the reminder time in your response using Discord timestamp format.

RECURRING:
- Set repeat to 'daily', 'weekly', or 'monthly' for recurring reminders.
- Optionally set repeat_until_utc to stop repeating after a date.`,
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'list', 'cancel'],
          description: 'The action to perform',
        },
        message: {
          type: 'string',
          description: 'For create: what to remind about. For cancel with search: text to search for.',
        },
        trigger_at_utc: {
          type: 'string',
          description: 'For create: ISO 8601 UTC timestamp when reminder should trigger (e.g., "2025-01-15T14:00:00Z")',
        },
        repeat: {
          type: 'string',
          enum: ['daily', 'weekly', 'monthly'],
          description: 'For create: make this a recurring reminder',
        },
        repeat_until_utc: {
          type: 'string',
          description: 'For create with repeat: stop repeating after this UTC timestamp',
        },
        reminder_id: {
          type: 'number',
          description: 'For cancel: the specific reminder ID to cancel',
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
    strict: true,
  };

  async execute(args: unknown, context: ToolExecutionContext): Promise<ToolResult> {
    const params = args as {
      action: 'create' | 'list' | 'cancel';
      message?: string;
      trigger_at_utc?: string;
      repeat?: 'daily' | 'weekly' | 'monthly';
      repeat_until_utc?: string;
      reminder_id?: number;
    };

    context.logger.debug('[ReminderTool] Executing', { action: params.action });

    // Get database user ID
    const user = getUserByPlatformId(context.message.platform, context.user.id);
    if (!user) {
      return {
        success: false,
        error: {
          type: 'user_not_found',
          message: 'Could not find your user record. Please send a message first.',
        },
      };
    }

    switch (params.action) {
      case 'create':
        return this.createReminder(params, context, user.id);
      case 'list':
        return this.listReminders(user.id);
      case 'cancel':
        return this.cancelReminder(params, context, user.id);
      default:
        return {
          success: false,
          error: {
            type: 'invalid_action',
            message: `Unknown action: ${params.action}`,
          },
        };
    }
  }

  private async createReminder(
    params: {
      message?: string;
      trigger_at_utc?: string;
      repeat?: 'daily' | 'weekly' | 'monthly';
      repeat_until_utc?: string;
    },
    context: ToolExecutionContext,
    userId: number,
  ): Promise<ToolResult> {
    if (!params.message) {
      return {
        success: false,
        error: {
          type: 'missing_parameter',
          message: 'Message is required for creating a reminder',
        },
      };
    }

    if (!params.trigger_at_utc) {
      return {
        success: false,
        error: {
          type: 'missing_parameter',
          message: 'trigger_at_utc is required for creating a reminder',
        },
      };
    }

    // Parse the UTC timestamp
    const triggerDate = new Date(params.trigger_at_utc);
    if (Number.isNaN(triggerDate.getTime())) {
      return {
        success: false,
        error: {
          type: 'invalid_timestamp',
          message: `Invalid timestamp: ${params.trigger_at_utc}. Use ISO 8601 format.`,
        },
      };
    }

    const triggerAt = Math.floor(triggerDate.getTime() / 1000);
    const now = Math.floor(Date.now() / 1000);

    // Don't allow reminders in the past
    if (triggerAt <= now) {
      return {
        success: false,
        error: {
          type: 'invalid_time',
          message: 'Cannot create a reminder in the past. Please specify a future time.',
        },
      };
    }

    // Check reminder limit (prevent spam)
    const existingCount = getUserReminderCount(userId);
    if (existingCount >= 50) {
      return {
        success: false,
        error: {
          type: 'limit_reached',
          message: 'You have reached the maximum of 50 pending reminders. Please cancel some before creating new ones.',
        },
      };
    }

    // Parse repeat end time if provided
    let repeatEndAt: number | undefined;
    if (params.repeat_until_utc) {
      const repeatEndDate = new Date(params.repeat_until_utc);
      if (!Number.isNaN(repeatEndDate.getTime())) {
        repeatEndAt = Math.floor(repeatEndDate.getTime() / 1000);
      }
    }

    // Create the reminder with source message reference
    const reminderId = createReminder({
      userId,
      guildId: context.message.guildId,
      channelId: context.channel.id,
      platform: context.message.platform,
      message: params.message,
      triggerAt,
      repeatInterval: params.repeat,
      repeatEndAt,
      sourceMessageId: context.message.id, // Link back to original message
    });

    context.logger.info('[ReminderTool] Created reminder', {
      reminderId,
      userId,
      triggerAt,
      repeat: params.repeat,
    });

    return {
      success: true,
      data: {
        reminder_id: reminderId,
        message: params.message,
        trigger_at_unix: triggerAt,
        trigger_at_discord: `<t:${triggerAt}:F>`,
        trigger_at_relative: `<t:${triggerAt}:R>`,
        repeat: params.repeat ?? null,
        note: 'Reminder will be delivered via DM',
      },
    };
  }

  private async listReminders(userId: number): Promise<ToolResult> {
    const reminders = getUserPendingReminders(userId);

    if (reminders.length === 0) {
      return {
        success: true,
        data: {
          count: 0,
          reminders: [],
          message: 'No pending reminders',
        },
      };
    }

    const formattedReminders = reminders.map((r) => ({
      id: r.id,
      message: r.message,
      trigger_at_unix: r.trigger_at,
      trigger_at_discord: `<t:${r.trigger_at}:F>`,
      trigger_at_relative: `<t:${r.trigger_at}:R>`,
      repeat: r.repeat_interval,
      snooze_count: r.snooze_count,
    }));

    return {
      success: true,
      data: {
        count: reminders.length,
        reminders: formattedReminders,
      },
    };
  }

  private async cancelReminder(
    params: { reminder_id?: number; message?: string },
    context: ToolExecutionContext,
    userId: number,
  ): Promise<ToolResult> {
    let cancelled: Reminder | null = null;

    if (params.reminder_id) {
      // Cancel by ID
      const success = cancelReminder(params.reminder_id);
      if (success) {
        cancelled = { id: params.reminder_id } as Reminder;
      }
    } else if (params.message) {
      // Cancel by searching message text
      cancelled = cancelReminderByText(userId, params.message);
    } else {
      return {
        success: false,
        error: {
          type: 'missing_parameter',
          message: 'Either reminder_id or message search text is required to cancel a reminder',
        },
      };
    }

    if (!cancelled) {
      return {
        success: false,
        error: {
          type: 'not_found',
          message: params.reminder_id
            ? `Could not find reminder with ID ${params.reminder_id}`
            : `Could not find a pending reminder matching "${params.message}"`,
        },
      };
    }

    context.logger.info('[ReminderTool] Cancelled reminder', {
      reminderId: cancelled.id,
      userId,
    });

    return {
      success: true,
      data: {
        cancelled_id: cancelled.id,
        message: cancelled.message ?? 'Reminder cancelled',
      },
    };
  }
}
