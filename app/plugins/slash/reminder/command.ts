/**
 * /reminder command definition
 */

import type { SlashCommandDefinition } from '@core';

export const reminderCommand: SlashCommandDefinition = {
  name: 'reminder',
  description: 'Manage your reminders',
  subcommands: [
    {
      name: 'set',
      description: 'Set a new reminder',
      options: [
        {
          name: 'message',
          description: 'What to remind you about',
          type: 'string',
          required: true,
        },
        {
          name: 'time',
          description: 'When to remind (e.g., "30m", "2h", "1d", or "2025-01-15 14:00")',
          type: 'string',
          required: true,
        },
        {
          name: 'repeat',
          description: 'Make this a recurring reminder',
          type: 'string',
          required: false,
          choices: [
            { name: 'Daily', value: 'daily' },
            { name: 'Weekly', value: 'weekly' },
            { name: 'Monthly', value: 'monthly' },
          ],
        },
        {
          name: 'timezone',
          description: 'Timezone (default: UTC)',
          type: 'string',
          required: false,
          autocomplete: true,
        },
      ],
    },
    {
      name: 'list',
      description: 'List your pending reminders',
    },
    {
      name: 'cancel',
      description: 'Cancel a reminder',
      options: [
        {
          name: 'id',
          description: 'Select a reminder to cancel',
          type: 'integer',
          required: true,
          autocomplete: true,
        },
      ],
    },
  ],
};
