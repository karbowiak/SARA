/**
 * Demo select menu handler
 */

import type { BotSelectMenu, CommandInvocation, SelectMenuInteraction } from '@core';

export async function handleSelectCommand(invocation: CommandInvocation): Promise<void> {
  const selectMenu: BotSelectMenu = {
    type: 'select',
    customId: 'demo_color_select',
    placeholder: 'Choose your favorite colors',
    minValues: 1,
    maxValues: 3,
    options: [
      { label: 'Red', value: 'red', description: 'The color of fire', emoji: '🔴' },
      { label: 'Green', value: 'green', description: 'The color of nature', emoji: '🟢' },
      { label: 'Blue', value: 'blue', description: 'The color of sky', emoji: '🔵' },
      { label: 'Yellow', value: 'yellow', description: 'The color of sun', emoji: '🟡' },
      { label: 'Purple', value: 'purple', description: 'The color of royalty', emoji: '🟣' },
    ],
  };

  await invocation.reply({
    content: '🎨 **Select Menu Demo**\nChoose up to 3 colors:',
    components: [[selectMenu]],
  });
}

export async function handleSelect(interaction: SelectMenuInteraction): Promise<void> {
  if (interaction.customId !== 'demo_color_select') return;

  const colors = interaction.values;
  const colorEmojis: Record<string, string> = {
    red: '🔴',
    green: '🟢',
    blue: '🔵',
    yellow: '🟡',
    purple: '🟣',
  };

  const selected = colors.map((c) => `${colorEmojis[c]} ${c}`).join(', ');

  await interaction.update({
    content: `🎨 **Select Menu Demo**\nYou selected: ${selected}`,
    components: [],
  });
}
