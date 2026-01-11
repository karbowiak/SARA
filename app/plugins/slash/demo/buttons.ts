/**
 * Demo button handlers
 */

import type { BotButton, ButtonInteraction, CommandInvocation } from '@core';

// Track click counts per user
const clickCounts = new Map<string, number>();

export async function handleButtonsCommand(invocation: CommandInvocation): Promise<void> {
  const userId = invocation.user.id;
  clickCounts.set(userId, 0);

  await invocation.reply({
    content: '🔘 **Button Demo**\nClick the buttons to see different responses:',
    components: [[...createButtons(0)]],
  });
}

export async function handleButton(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.customId.startsWith('demo_')) return;

  const action = interaction.customId.replace('demo_', '');

  switch (action) {
    case 'click': {
      const count = (clickCounts.get(interaction.user.id) ?? 0) + 1;
      clickCounts.set(interaction.user.id, count);

      await interaction.update({
        content: `🔘 **Button Demo**\nYou've clicked ${count} time(s)!`,
        components: [[...createButtons(count)]],
      });
      break;
    }
    case 'success':
      await interaction.reply({
        content: '✅ Success button clicked!',
        ephemeral: true,
      });
      break;
    case 'danger':
      await interaction.reply({
        content: '⚠️ Danger button clicked! Be careful!',
        ephemeral: true,
      });
      break;
    case 'secondary':
      await interaction.reply({
        content: '📝 Secondary button clicked.',
        ephemeral: true,
      });
      break;
    case 'embed_like':
      await interaction.reply({
        content: '👍 You liked this embed!',
        ephemeral: true,
      });
      break;
    case 'embed_dislike':
      await interaction.reply({
        content: '👎 You disliked this embed!',
        ephemeral: true,
      });
      break;
  }
}

function createButtons(clickCount: number): BotButton[] {
  return [
    { type: 'button', customId: 'demo_click', label: `Click me! (${clickCount})`, style: 'primary' },
    { type: 'button', customId: 'demo_success', label: '✓ Success', style: 'success' },
    { type: 'button', customId: 'demo_danger', label: '✗ Danger', style: 'danger' },
    { type: 'button', customId: 'demo_secondary', label: 'Secondary', style: 'secondary' },
  ];
}
