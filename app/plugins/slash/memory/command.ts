/**
 * /memory command definition
 *
 * Allows users to view and manage their stored memories
 * Subcommands: add (modal), list, delete, clear
 */

import type { SlashCommandDefinition } from '@core';

export const memoryCommand: SlashCommandDefinition = {
  name: 'memory',
  description: 'View and manage what the bot remembers about you',
  guildOnly: true,
  subcommands: [
    {
      name: 'add',
      description: 'Add a new memory (opens a form)',
    },
    {
      name: 'list',
      description: 'List all memories the bot has about you',
      options: [
        {
          name: 'type',
          description: 'Filter by memory type',
          type: 'string',
          required: false,
          choices: [
            { name: 'Preferences', value: 'preference' },
            { name: 'Facts', value: 'fact' },
            { name: 'Instructions', value: 'instruction' },
            { name: 'Context', value: 'context' },
          ],
        },
      ],
    },
    {
      name: 'delete',
      description: 'Delete a specific memory',
      options: [
        {
          name: 'memory',
          description: 'Select a memory to delete',
          type: 'string',
          required: true,
          autocomplete: true,
        },
      ],
    },
    {
      name: 'clear',
      description: 'Delete all your memories in this server',
    },
  ],
};
