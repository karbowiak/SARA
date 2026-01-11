/**
 * Demo modal handler
 */

import type { CommandInvocation, Logger, ModalSubmitInteraction } from '@core';

export async function handleModalCommand(invocation: CommandInvocation): Promise<void> {
  await invocation.showModal({
    customId: 'demo_feedback_modal',
    title: 'Feedback Form',
    fields: [
      {
        customId: 'feedback_title',
        label: 'Title',
        style: 'short',
        placeholder: 'Brief summary...',
        required: true,
        maxLength: 100,
      },
      {
        customId: 'feedback_description',
        label: 'Description',
        style: 'paragraph',
        placeholder: 'Detailed feedback...',
        required: true,
        minLength: 10,
        maxLength: 1000,
      },
      {
        customId: 'feedback_rating',
        label: 'Rating (1-5)',
        style: 'short',
        placeholder: '5',
        required: false,
        maxLength: 1,
      },
    ],
  });
}

export async function handleModal(interaction: ModalSubmitInteraction, logger?: Logger): Promise<void> {
  if (interaction.customId !== 'demo_feedback_modal') return;

  const title = interaction.fields.feedback_title;
  const description = interaction.fields.feedback_description;
  const rating = interaction.fields.feedback_rating || 'Not provided';

  await interaction.reply({
    content: [
      '📝 **Feedback Received!**',
      '',
      `**Title:** ${title}`,
      `**Description:** ${description}`,
      `**Rating:** ${rating}`,
    ].join('\n'),
    ephemeral: true,
  });

  logger?.info('Feedback received', {
    userId: interaction.user.id,
    title,
    rating,
  });
}
