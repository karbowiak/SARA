/**
 * Demo embed handler
 */

import type { BotButton, CommandInvocation } from '@core';

export async function handleEmbedCommand(invocation: CommandInvocation): Promise<void> {
  const buttons: BotButton[] = [
    { type: 'button', customId: 'demo_embed_like', label: '👍 Like', style: 'success' },
    { type: 'button', customId: 'demo_embed_dislike', label: '👎 Dislike', style: 'danger' },
  ];

  await invocation.reply({
    embeds: [
      {
        title: '📊 Demo Embed',
        description: 'This is a demo embed with interactive components below.',
        color: 0x5865f2,
        fields: [
          { name: 'Feature 1', value: 'Embeds can have fields', inline: true },
          { name: 'Feature 2', value: 'Fields can be inline', inline: true },
          { name: 'Feature 3', value: 'Or take the full width', inline: false },
        ],
        footer: { text: 'Demo Plugin • Click the buttons below' },
        timestamp: new Date(),
      },
    ],
    components: [[...buttons]],
  });
}
