/**
 * /knowledge command definition
 */

import type { SlashCommandDefinition } from '@core';

export const knowledgeCommand: SlashCommandDefinition = {
  name: 'knowledge',
  description: 'Manage the server knowledge base',
  guildOnly: true,
  subcommands: [
    {
      name: 'add',
      description: 'Add a new knowledge entry (opens a form)',
    },
    {
      name: 'search',
      description: 'Search the knowledge base',
      options: [
        {
          name: 'query',
          description: 'What to search for',
          type: 'string',
          required: true,
        },
        {
          name: 'tag',
          description: 'Filter by tag',
          type: 'string',
          required: false,
          autocomplete: true,
        },
      ],
    },
    {
      name: 'list',
      description: 'List knowledge entries',
      options: [
        {
          name: 'tag',
          description: 'Filter by tag',
          type: 'string',
          required: false,
          autocomplete: true,
        },
      ],
    },
    {
      name: 'get',
      description: 'Get a specific knowledge entry by ID',
      options: [
        {
          name: 'id',
          description: 'Knowledge entry ID',
          type: 'integer',
          required: true,
          autocomplete: true,
        },
      ],
    },
    {
      name: 'delete',
      description: 'Delete a knowledge entry',
      options: [
        {
          name: 'id',
          description: 'Knowledge entry ID to delete',
          type: 'integer',
          required: true,
          autocomplete: true,
        },
      ],
    },
    {
      name: 'tags',
      description: 'List all tags used in the knowledge base',
    },
  ],
};
