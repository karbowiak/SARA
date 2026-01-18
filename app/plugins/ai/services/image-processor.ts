import { convertToPng } from '@app/helpers/image';
import type { BotMessage, ContentPart } from '@core';

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

    const list = images.map((img, i) => `- Image ${i + 1}: ${img.url}`).join('\n');
    return `# Image Attachments
The user attached image(s):
${list}

If the user asks to edit/transform/use these images as a reference, call image_generation and set reference_image_url to the most relevant image URL.`;
  }

  /**
   * Convert images to base64 PNGs for the model
   */
  async buildImageParts(images: BotMessage['attachments']): Promise<ContentPart[]> {
    const parts: ContentPart[] = [];

    for (const img of images) {
      try {
        const response = await fetch(img.url, { signal: AbortSignal.timeout(15000) });
        if (!response.ok) {
          parts.push({ type: 'image_url', image_url: { url: img.url } });
          continue;
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        const pngBuffer = await convertToPng(buffer);
        const base64 = pngBuffer.toString('base64');
        parts.push({ type: 'image_url', image_url: { url: `data:image/png;base64,${base64}` } });
      } catch {
        // Fallback to original URL if conversion fails
        parts.push({ type: 'image_url', image_url: { url: img.url } });
      }
    }

    return parts;
  }
}
