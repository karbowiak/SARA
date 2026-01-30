/**
 * /migrate command definition
 *
 * Allows users to migrate their memories or profile data between servers or to global scope.
 * This command is guild-only since you need to be in a server to migrate FROM it.
 */

import type { SlashCommandDefinition } from '@core';

export const migrateCommand: SlashCommandDefinition = {
  name: 'migrate',
  description: 'Migrate your memories or profile to another server or global',
  guildOnly: true, // Must be in a guild to migrate FROM it
  subcommands: [
    {
      name: 'memory',
      description: 'Migrate your memories from this server',
      options: [
        {
          name: 'destination',
          description: 'Where to migrate (global or another server)',
          type: 'string',
          required: true,
          autocomplete: true,
        },
      ],
    },
    {
      name: 'profile',
      description: 'Migrate your profile from this server',
      options: [
        {
          name: 'destination',
          description: 'Where to migrate (global or another server)',
          type: 'string',
          required: true,
          autocomplete: true,
        },
      ],
    },
  ],
};
