/**
 * /profile command definition
 *
 * Allows users to view and manage their user profile
 * Subcommands: view, generate, edit, optout, optin
 */

import type { SlashCommandDefinition } from '@core';

export const profileCommand: SlashCommandDefinition = {
  name: 'profile',
  description: 'Manage your user profile - what Sara knows about you',
  guildOnly: true,
  subcommands: [
    {
      name: 'view',
      description: 'View your profile (what Sara knows about you)',
    },
    {
      name: 'generate',
      description: 'Generate or update your profile from recent messages (once per 24h)',
    },
    {
      name: 'edit',
      description: 'Edit your profile to fix inaccuracies',
    },
    {
      name: 'optout',
      description: 'Disable automatic profile features',
    },
    {
      name: 'optin',
      description: 'Re-enable automatic profile features',
    },
  ],
};
