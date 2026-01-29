import { convertToPng } from '@app/helpers/image';
import type { BotAttachment, BotMessage, ContentPart } from '@core';

/**
 * Get the preferred URL for an attachment (proxyUrl for reliability, fallback to url)
 */
function getPreferredUrl(attachment: BotAttachment): string {
  return attachment.proxyUrl || attachment.url;
}

export class ImageProcessor {
  /**
   * Return image attachments suitable for multimodal input
   */
  getImageAttachments(message: BotMessage): BotMessage['attachments'] {
    return message.attachments.filter(
      (a) => a.contentType?.startsWith('image/') || /\.(png|jpg|jpeg|gif|webp)$/i.test(a.filename),
    );
  }

  /**
   * Build system prompt context for attached images
   */
  buildImageAttachmentContext(message: BotMessage): string | null {
    const images = this.getImageAttachments(message);
    if (images.length === 0) return null;

    const list = images.map((img, i) => `- Image ${i + 1}: ${getPreferredUrl(img)}`).join('\n');
    return `# Image Attachments
The user attached image(s):
${list}

If the user asks to edit/transform/use these images as a reference, call image_generation and set reference_image_url to the most relevant image URL.`;
  }

  /**
   * Convert images to base64 PNGs for the model
   */
  async buildImageParts(images: BotMessage['attachments']): Promise<ContentPart[]> {
    const results = await Promise.all(
      images.map(async (img) => {
        const url = getPreferredUrl(img);

        try {
          const response = await fetch(url, { signal: AbortSignal.timeout(15000) });

          if (!response.ok) {
            // Return URL directly if fetch fails
            return {
              type: 'image_url' as const,
              image_url: { url },
            };
          }

          const buffer = Buffer.from(await response.arrayBuffer());
          const pngBuffer = await convertToPng(buffer);
          const base64 = pngBuffer.toString('base64');

          return {
            type: 'image_url' as const,
            image_url: { url: `data:image/png;base64,${base64}` },
          };
        } catch {
          // Fallback to original URL on error
          return {
            type: 'image_url' as const,
            image_url: { url },
          };
        }
      }),
    );

    return results;
  }
}
