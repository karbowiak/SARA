/**
 * Demo autocomplete handler
 */

import type { AutocompleteRequest, CommandInvocation } from '@core';

const FRUITS = [
  'Apple',
  'Apricot',
  'Avocado',
  'Banana',
  'Blackberry',
  'Blueberry',
  'Cherry',
  'Coconut',
  'Cranberry',
  'Dragon Fruit',
  'Durian',
  'Elderberry',
  'Fig',
  'Grape',
  'Grapefruit',
  'Guava',
  'Honeydew',
  'Kiwi',
  'Kumquat',
  'Lemon',
  'Lime',
  'Lychee',
  'Mango',
  'Melon',
  'Nectarine',
  'Orange',
  'Papaya',
  'Passion Fruit',
  'Peach',
  'Pear',
  'Pineapple',
  'Plum',
  'Pomegranate',
  'Raspberry',
  'Strawberry',
  'Tangerine',
  'Watermelon',
];

export async function handleAutocomplete(request: AutocompleteRequest): Promise<void> {
  if (request.commandName !== 'demo') return;
  if (request.focusedOption.name !== 'fruit') return;

  const search = request.focusedOption.value.toLowerCase();
  const matches = FRUITS.filter((f) => f.toLowerCase().includes(search))
    .slice(0, 25)
    .map((f) => ({ name: f, value: f.toLowerCase() }));

  await request.respond(matches);
}

export async function handleAutocompleteCommand(invocation: CommandInvocation): Promise<void> {
  const fruit = invocation.args.fruit as string;
  await invocation.reply({
    content: `🍎 You selected: **${fruit}**`,
    ephemeral: true,
  });
}
