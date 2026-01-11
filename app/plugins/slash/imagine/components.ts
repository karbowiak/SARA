/**
 * Imagine Command - Button Components
 *
 * Creates interactive buttons for image generation results.
 */

import type { BotButton } from '@core';

/**
 * Button actions for imagine command
 */
export type ImagineAction = 'regen' | 'vary' | 'upscale';

/**
 * Create customId with action and user ID for ownership check
 */
export function createCustomId(action: ImagineAction, userId: string): string {
  return `imagine_${action}_${userId}`;
}

/**
 * Parse customId to extract action and owner user ID
 */
export function parseCustomId(customId: string): { action: ImagineAction; ownerId: string } | null {
  if (!customId.startsWith('imagine_')) return null;

  const parts = customId.split('_');
  if (parts.length !== 3) return null;

  const action = parts[1];
  const ownerId = parts[2];

  if (!action || !ownerId) return null;

  if (!['regen', 'vary', 'upscale'].includes(action)) {
    return null;
  }

  return { action: action as ImagineAction, ownerId };
}

/**
 * Create the button row for an image generation result
 */
export function createImageButtons(userId: string, canUpscale: boolean = true): BotButton[] {
  const buttons: BotButton[] = [
    {
      type: 'button',
      customId: createCustomId('regen', userId),
      label: '🔄 Regenerate',
      style: 'primary',
    },
    {
      type: 'button',
      customId: createCustomId('vary', userId),
      label: '🎨 Vary',
      style: 'primary',
    },
  ];

  // Only show upscale if not already at max resolution
  if (canUpscale) {
    buttons.push({
      type: 'button',
      customId: createCustomId('upscale', userId),
      label: '⬆️ Upscale',
      style: 'success',
    });
  }

  return buttons;
}
