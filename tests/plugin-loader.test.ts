/**
 * Plugin Loader unit tests
 */

import { describe, expect, test } from 'bun:test';
import { type BotMessage, type MessageHandlerPlugin, shouldHandlerProcess } from '@core';

describe('PluginLoader', () => {
  describe('shouldHandlerProcess()', () => {
    const createMessage = (overrides: Partial<BotMessage> = {}): BotMessage => {
      // Extract guildId from channel if provided
      const channelOverride = overrides.channel;
      const guildId =
        overrides.guildId ?? (channelOverride && 'guildId' in channelOverride ? channelOverride.guildId : 'guild-123');

      return {
        id: 'msg-1',
        content: 'test message',
        author: { id: 'user-1', name: 'TestUser', isBot: false },
        channel: { id: 'channel-1', type: 'guild' },
        attachments: [],
        mentionedUserIds: [],
        mentionedUsers: [],
        mentionedBot: false,
        timestamp: new Date(),
        platform: 'discord',
        guildId,
        ...overrides,
      };
    };

    const createHandler = (overrides: Partial<MessageHandlerPlugin> = {}): MessageHandlerPlugin => ({
      id: 'test-handler',
      type: 'message',
      load: async () => {},
      unload: async () => {},
      shouldHandle: () => true,
      handle: async () => {},
      ...overrides,
    });

    describe('scope filtering', () => {
      test('should reject non-mention messages when scope is undefined (default)', () => {
        const handler = createHandler();
        const message = createMessage({ mentionedBot: false });

        expect(shouldHandlerProcess(handler, message)).toBe(false);
      });

      test('should accept mention messages when scope is undefined', () => {
        const handler = createHandler();
        const message = createMessage({ mentionedBot: true });

        expect(shouldHandlerProcess(handler, message)).toBe(true);
      });

      test("should accept all messages when scope is 'all'", () => {
        const handler = createHandler({ scope: 'all' });
        const message = createMessage({ mentionedBot: false });

        expect(shouldHandlerProcess(handler, message)).toBe(true);
      });
    });

    describe('platform filtering', () => {
      test('should accept any platform when platforms is undefined', () => {
        const handler = createHandler({ scope: 'all' });

        expect(shouldHandlerProcess(handler, createMessage({ platform: 'discord' }))).toBe(true);
        expect(shouldHandlerProcess(handler, createMessage({ platform: 'slack' }))).toBe(true);
      });

      test('should reject messages from non-matching platforms', () => {
        const handler = createHandler({
          scope: 'all',
          platforms: ['discord'] as const,
        });
        const message = createMessage({ platform: 'slack' });

        expect(shouldHandlerProcess(handler, message)).toBe(false);
      });

      test('should accept messages from matching platforms', () => {
        const handler = createHandler({
          scope: 'all',
          platforms: ['discord', 'slack'] as const,
        });

        expect(shouldHandlerProcess(handler, createMessage({ platform: 'discord' }))).toBe(true);
        expect(shouldHandlerProcess(handler, createMessage({ platform: 'slack' }))).toBe(true);
      });
    });

    describe('guild filtering', () => {
      test('should accept any guild when guildIds is undefined', () => {
        const handler = createHandler({ scope: 'all' });

        expect(
          shouldHandlerProcess(
            handler,
            createMessage({
              guildId: 'guild-123',
              channel: { id: 'ch-1', type: 'guild' },
            }),
          ),
        ).toBe(true);

        expect(
          shouldHandlerProcess(
            handler,
            createMessage({
              guildId: 'guild-456',
              channel: { id: 'ch-2', type: 'guild' },
            }),
          ),
        ).toBe(true);
      });

      test('should reject messages from non-matching guilds', () => {
        const handler = createHandler({
          scope: 'all',
          guildIds: ['guild-123'] as const,
        });
        const message = createMessage({
          guildId: 'guild-456',
          channel: { id: 'ch-1', type: 'guild' },
        });

        expect(shouldHandlerProcess(handler, message)).toBe(false);
      });

      test('should accept messages from matching guilds', () => {
        const handler = createHandler({
          scope: 'all',
          guildIds: ['guild-123', 'guild-456'] as const,
        });

        expect(
          shouldHandlerProcess(
            handler,
            createMessage({
              guildId: 'guild-123',
              channel: { id: 'ch-1', type: 'guild' },
            }),
          ),
        ).toBe(true);
      });

      test('should accept DMs even with guild restrictions', () => {
        const handler = createHandler({
          scope: 'all',
          guildIds: ['guild-123'] as const,
        });
        const message = createMessage({
          guildId: undefined, // DMs don't have guildId
          channel: { id: 'ch-1', type: 'dm' },
        });

        // DMs don't have guildId, so guild filter doesn't apply
        expect(shouldHandlerProcess(handler, message)).toBe(true);
      });
    });

    describe('combined filters', () => {
      test('should require all conditions to pass', () => {
        const handler = createHandler({
          scope: 'all',
          platforms: ['discord'] as const,
          guildIds: ['guild-123'] as const,
        });

        // All conditions met
        expect(
          shouldHandlerProcess(
            handler,
            createMessage({
              platform: 'discord',
              guildId: 'guild-123',
              channel: { id: 'ch-1', type: 'guild' },
            }),
          ),
        ).toBe(true);

        // Wrong platform
        expect(
          shouldHandlerProcess(
            handler,
            createMessage({
              platform: 'slack',
              guildId: 'guild-123',
              channel: { id: 'ch-1', type: 'guild' },
            }),
          ),
        ).toBe(false);

        // Wrong guild
        expect(
          shouldHandlerProcess(
            handler,
            createMessage({
              platform: 'discord',
              guildId: 'guild-456',
              channel: { id: 'ch-1', type: 'guild' },
            }),
          ),
        ).toBe(false);
      });
    });
  });
});
