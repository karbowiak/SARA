/**
 * Tests for Media Plugin Splitting Logic
 */

import { describe, expect, it } from 'bun:test';
import { MediaService, type SocialPlatform } from '../../../app/plugins/media/media.service';

describe('MediaService', () => {
  const service = new MediaService();

  it('should split messages when attachments > 10', () => {
    // Mock metadata with 15 urls
    const urls = Array.from({ length: 15 }, (_, i) => `http://example.com/img${i}.jpg`);

    const metadata = {
      platform: 'instagram' as const,
      title: 'Test Post',
      originalUrl: 'http://instagram.com/p/123',
      items: urls.map((url) => ({ type: 'image' as const, url })),
      author: 'testuser',
    };

    const messages = service.formatResponse(metadata);

    expect(messages.length).toBe(2);
    expect(messages[0].files.length).toBe(10);
    expect(messages[1].files.length).toBe(5);
    expect(messages[0].content).toContain('Test Post');
    expect(messages[1].content).toContain('continued');
  });

  it('should not split messages when attachments <= 10', () => {
    const urls = Array.from({ length: 5 }, (_, i) => `http://example.com/img${i}.jpg`);

    const metadata = {
      platform: 'instagram' as const,
      title: 'Small Post',
      originalUrl: 'http://instagram.com/p/456',
      items: urls.map((url) => ({ type: 'image' as const, url })),
    };

    const messages = service.formatResponse(metadata);

    expect(messages.length).toBe(1);
    expect(messages[0].files.length).toBe(5);
  });
});
