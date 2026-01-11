/**
 * Demo command definition
 */

import type { SlashCommandDefinition } from '@core';

export const COMMAND_DEFINITION: SlashCommandDefinition = {
  name: 'demo',
  description: 'Demo command showcasing all interaction types',
  subcommands: [
    {
      name: 'autocomplete',
      description: 'Test autocomplete with fruit search',
      options: [
        {
          name: 'fruit',
          description: 'Search for a fruit',
          type: 'string',
          required: true,
          autocomplete: true,
        },
      ],
    },
    {
      name: 'buttons',
      description: 'Test button interactions',
    },
    {
      name: 'select',
      description: 'Test select menu interactions',
    },
    {
      name: 'modal',
      description: 'Test modal dialog',
    },
    {
      name: 'embed',
      description: 'Test embeds with components',
    },
  ],
};
