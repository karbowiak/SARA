/**
 * /config command definition
 *
 * Allows users to manage their personal bot settings
 * Subcommands: view, apikey, clearapikey, chatmodel, imagemodels, scope, reset
 * Subcommand group: webhook (add, list, remove, test)
 */

import type { SlashCommandDefinition } from '@core';

export const configCommand: SlashCommandDefinition = {
  name: 'config',
  description: 'Manage your personal bot settings',
  subcommands: [
    {
      name: 'view',
      description: 'View your current settings',
    },
    {
      name: 'apikey',
      description: 'Set your OpenRouter API key',
    },
    {
      name: 'clearapikey',
      description: 'Remove your stored API key',
    },
    {
      name: 'chatmodel',
      description: 'Set your default chat model',
    },
    {
      name: 'imagemodels',
      description: 'Set your preferred image generation models',
    },
    {
      name: 'scope',
      description: 'Set memory/profile scope (per-server or global)',
      options: [
        {
          name: 'mode',
          description: 'Scope mode for new memories and profiles',
          type: 'string',
          required: true,
          choices: [
            { name: 'Per-server (default) - separate for each server', value: 'guild' },
            { name: 'Global - shared across all servers and DMs', value: 'global' },
          ],
        },
      ],
    },
    {
      name: 'reset',
      description: 'Clear all your settings',
    },
  ],
  subcommandGroups: [
    {
      name: 'webhook',
      description: 'Manage webhooks for image routing',
      subcommands: [
        {
          name: 'add',
          description: 'Add a new webhook for image routing',
        },
        {
          name: 'list',
          description: 'List your configured webhooks',
        },
        {
          name: 'remove',
          description: 'Remove a webhook',
          options: [
            {
              name: 'name',
              description: 'Name of the webhook to remove',
              type: 'string',
              required: false,
              autocomplete: true,
            },
          ],
        },
        {
          name: 'test',
          description: 'Test a webhook with a sample image',
          options: [
            {
              name: 'name',
              description: 'Name of the webhook to test',
              type: 'string',
              required: false,
              autocomplete: true,
            },
          ],
        },
      ],
    },
  ],
};
