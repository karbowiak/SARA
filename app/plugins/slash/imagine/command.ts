/**
 * Imagine Command Definition
 *
 * Midjourney-style image generation command with interactive buttons.
 */

import { getBotConfig, type SlashCommandDefinition } from '@core';

/**
 * Predefined style choices for image generation
 */
export const IMAGE_STYLES = [
  { name: 'Photorealistic', value: 'photorealistic, highly detailed photograph' },
  { name: 'Anime', value: 'anime style, vibrant colors, clean lines' },
  { name: 'Oil Painting', value: 'oil painting, textured brushstrokes, classical art' },
  { name: 'Watercolor', value: 'watercolor painting, soft edges, flowing colors' },
  { name: 'Digital Art', value: 'digital art, clean, modern illustration' },
  { name: 'Pixel Art', value: 'pixel art, retro 16-bit style' },
  { name: '3D Render', value: '3D render, octane render, realistic lighting' },
  { name: 'Cinematic', value: 'cinematic, dramatic lighting, movie still, 35mm film' },
  { name: 'Comic Book', value: 'comic book style, bold outlines, halftone dots' },
  { name: 'Fantasy Art', value: 'fantasy art, epic, magical, detailed illustration' },
  { name: 'Cyberpunk', value: 'cyberpunk, neon lights, futuristic, dark atmosphere' },
  { name: 'Studio Ghibli', value: 'Studio Ghibli style, whimsical, hand-drawn animation' },
  { name: 'Minimalist', value: 'minimalist, simple, clean, flat design' },
  { name: 'Vintage/Retro', value: 'vintage, retro, 1970s aesthetic, film grain' },
  { name: 'Sketch', value: 'pencil sketch, hand-drawn, graphite on paper' },
  { name: 'Impressionist', value: 'impressionist painting, loose brushwork, Monet style' },
  { name: 'Art Nouveau', value: 'art nouveau, ornate, flowing lines, decorative' },
  { name: 'Steampunk', value: 'steampunk, Victorian, brass and gears, industrial' },
  { name: 'Vaporwave', value: 'vaporwave aesthetic, pink and blue, 80s nostalgia, glitch' },
  { name: 'Ukiyo-e', value: 'ukiyo-e, Japanese woodblock print style' },
  { name: 'Pop Art', value: 'pop art, Andy Warhol style, bold colors, Ben-Day dots' },
  { name: 'Gothic', value: 'gothic art, dark, dramatic, medieval architecture' },
  { name: 'Surrealist', value: 'surrealist, dreamlike, Salvador Dali style' },
  { name: 'Low Poly', value: 'low poly 3D, geometric, faceted surfaces' },
  { name: 'Isometric', value: 'isometric view, 3D game art style, clean edges' },
] as const;

/**
 * Get model display name from model ID
 */
function getModelDisplayName(modelId: string): string {
  const parts = modelId.split('/');
  const name = parts[parts.length - 1] ?? modelId;
  // Capitalize and clean up
  return name
    .replace(/-/g, ' ')
    .replace(/\./g, ' ')
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Build model choices from config
 */
function getModelChoices(): Array<{ name: string; value: string }> {
  try {
    const config = getBotConfig();
    const models = config.ai?.imageModels ?? [];
    if (models.length === 0) {
      // Fall back to default if no models configured
      return [{ name: 'GPT 5 Image Mini', value: 'openai/gpt-5-image-mini' }];
    }
    return models.slice(0, 25).map((model) => ({
      name: getModelDisplayName(model),
      value: model,
    }));
  } catch {
    // Config not loaded yet, return empty (will use default)
    return [{ name: 'GPT 5 Image Mini', value: 'openai/gpt-5-image-mini' }];
  }
}

export const COMMAND_DEFINITION: SlashCommandDefinition = {
  name: 'imagine',
  description: 'Generate an image from a text prompt',
  options: [
    {
      name: 'prompt',
      description: 'Description of the image to generate',
      type: 'string',
      required: true,
    },
    {
      name: 'model',
      description: 'AI model to use (default: first in list)',
      type: 'string',
      required: false,
      choices: getModelChoices(),
    },
    {
      name: 'style',
      description: 'Art style preset (default: none)',
      type: 'string',
      required: false,
      choices: IMAGE_STYLES.slice(0, 25).map((s) => ({ name: s.name, value: s.value })), // Discord max 25 choices
    },
    {
      name: 'aspect',
      description: 'Aspect ratio (default: 1:1 Square)',
      type: 'string',
      required: false,
      choices: [
        { name: '1:1 Square', value: '1:1' },
        { name: '2:3 Portrait', value: '2:3' },
        { name: '3:2 Landscape', value: '3:2' },
        { name: '3:4 Portrait (4:3)', value: '3:4' },
        { name: '4:3 Landscape (4:3)', value: '4:3' },
        { name: '4:5 Instagram Portrait', value: '4:5' },
        { name: '9:16 Phone/Stories', value: '9:16' },
        { name: '16:9 Widescreen', value: '16:9' },
        { name: '21:9 Ultrawide', value: '21:9' },
      ],
    },
    {
      name: 'resolution',
      description: 'Image resolution (default: 1K)',
      type: 'string',
      required: false,
      choices: [
        { name: '1K - Standard', value: '1K' },
        { name: '2K - High', value: '2K' },
        { name: '4K - Ultra', value: '4K' },
      ],
    },
  ],
};
