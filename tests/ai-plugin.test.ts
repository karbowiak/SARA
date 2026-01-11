/**
 * AI Plugin unit tests
 */

import { beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { type BotMessage, createEventBus, type EventBus, type Logger, loadBotConfig, type PluginContext } from '@core';
import path from 'path';
import { AIPlugin } from '../app/plugins/ai/ai.plugin';

describe('AIPlugin', () => {
  let plugin: AIPlugin;
  let eventBus: EventBus;
  let logger: Logger;
  let context: PluginContext;

  // Load config once before all tests
  beforeAll(async () => {
    const configPath = path.resolve(process.cwd(), 'config/config.ts');
    try {
      await loadBotConfig(configPath);
    } catch {
      // If no config file exists, tests will fail
      // This allows tests to run in CI with real credentials
    }
  });

  beforeEach(() => {
    plugin = new AIPlugin();
    eventBus = createEventBus();
    logger = {
      debug: mock(() => {}),
      info: mock(() => {}),
      warn: mock(() => {}),
      error: mock(() => {}),
    };
    context = { eventBus, logger };
  });

  describe('lifecycle', () => {
    test('should have correct id and type', () => {
      expect(plugin.id).toBe('ai');
      expect(plugin.type).toBe('message');
    });

    test('should default to mention scope', () => {
      // scope is undefined, which means 'mention' by default
      expect((plugin as any).scope).toBeUndefined();
    });

    test('should load and unload without error', async () => {
      await plugin.load(context);

      // Should log loaded with model and tools
      expect(logger.info).toHaveBeenCalledWith(
        'AIPlugin loaded',
        expect.objectContaining({
          model: 'x-ai/grok-4.1-fast',
          botName: 'Tim',
        }),
      );

      await plugin.unload();
      expect(logger.info).toHaveBeenCalledWith('AIPlugin unloaded');
    });

    test('should register channel_history tool by default', async () => {
      await plugin.load(context);
      const tools = plugin.getTools();
      expect(tools.some((t) => t.metadata.name === 'channel_history')).toBe(true);
    });
  });

  describe('shouldHandle()', () => {
    test('should handle non-bot messages', () => {
      const message = createMessage({ author: { id: '1', name: 'User', isBot: false } });
      expect(plugin.shouldHandle(message)).toBe(true);
    });

    test('should not handle bot messages', () => {
      const message = createMessage({ author: { id: '1', name: 'Bot', isBot: true } });
      expect(plugin.shouldHandle(message)).toBe(false);
    });
  });

  describe('handle()', () => {
    test('should emit ai:processing event', async () => {
      await plugin.load(context);

      let processingEvent: unknown = null;
      eventBus.on('ai:processing', (event) => {
        processingEvent = event;
      });

      const message = createMessage({ content: '@bot hello' });
      await plugin.handle(message, context);

      expect(processingEvent).not.toBeNull();
      expect((processingEvent as any).messageId).toBe(message.id);
      expect((processingEvent as any).userId).toBe(message.author.id);
      expect((processingEvent as any).model).toBe('x-ai/grok-4.1-fast');
    });

    test('should emit message:send event', async () => {
      await plugin.load(context);

      let sentMessage: unknown = null;
      eventBus.on('message:send', (msg) => {
        sentMessage = msg;
      });

      const message = createMessage({ content: '@bot hello' });
      await plugin.handle(message, context);

      expect(sentMessage).not.toBeNull();
      expect((sentMessage as any).channelId).toBe('channel-001');
      expect((sentMessage as any).message.replyToId).toBe(message.id);
    });

    test('should emit ai:response event on success', async () => {
      await plugin.load(context);

      let responseEvent: unknown = null;
      eventBus.on('ai:response', (event) => {
        responseEvent = event;
      });

      const message = createMessage({ content: 'test message' });
      await plugin.handle(message, context);

      expect(responseEvent).not.toBeNull();
      expect((responseEvent as any).messageId).toBe(message.id);
      expect((responseEvent as any).model).toBe('x-ai/grok-4.1-fast');
      expect((responseEvent as any).totalDurationMs).toBeGreaterThan(0);
    });

    test('should log processing started', async () => {
      await plugin.load(context);

      const message = createMessage({ content: 'test message' });
      await plugin.handle(message, context);

      expect(logger.info).toHaveBeenCalledWith(
        'AI processing started',
        expect.objectContaining({
          messageId: message.id,
          author: 'TestUser',
        }),
      );
    });

    test('should emit typing indicators', async () => {
      await plugin.load(context);

      const typingEvents: unknown[] = [];
      eventBus.on('typing:start', (event) => typingEvents.push({ type: 'start', ...event }));
      eventBus.on('typing:stop', (event) => typingEvents.push({ type: 'stop', ...event }));

      const message = createMessage({ content: 'test' });
      await plugin.handle(message, context);

      expect(typingEvents.length).toBe(2);
      expect((typingEvents[0] as any).type).toBe('start');
      expect((typingEvents[1] as any).type).toBe('stop');
    });
  });

  describe('tool management', () => {
    test('should register tools', async () => {
      await plugin.load(context);

      const mockTool = {
        metadata: {
          name: 'test_tool',
          description: 'Test tool',
          version: '1.0.0',
          author: 'Test',
          keywords: ['test'],
          category: 'utility' as const,
          priority: 5,
        },
        schema: {
          type: 'function' as const,
          name: 'test_tool',
          description: 'Test tool',
          parameters: { type: 'object' as const, properties: {}, required: [] },
        },
        execute: async () => ({ success: true }),
      };

      plugin.registerTool(mockTool);

      const tools = plugin.getTools();
      expect(tools.map((t) => t.metadata.name)).toContain('test_tool');
      expect(tools.map((t) => t.metadata.name)).toContain('channel_history');
    });

    test('should have channel_history tool after load', async () => {
      await plugin.load(context);
      expect(plugin.getTools().length).toBeGreaterThanOrEqual(1);
      expect(plugin.getTools().some((t) => t.metadata.name === 'channel_history')).toBe(true);
    });

    test('should log when registering tools', async () => {
      await plugin.load(context);

      expect(logger.info).toHaveBeenCalledWith('Registered AI tool: channel_history');
    });
  });

  describe('AI events', () => {
    test('should emit ai:error on failure', async () => {
      await plugin.load(context);

      // Force an error by mocking the LLM
      (plugin as any).llm = {
        chat: async () => {
          throw new Error('Test error');
        },
      };

      let errorEvent: unknown = null;
      eventBus.on('ai:error', (event) => {
        errorEvent = event;
      });

      const message = createMessage({ content: 'test' });
      await plugin.handle(message, context);

      expect(errorEvent).not.toBeNull();
      expect((errorEvent as any).error).toBe('Test error');
      expect((errorEvent as any).phase).toBe('response');
    });
  });
});

// Helper
function createMessage(overrides: Partial<BotMessage> = {}): BotMessage {
  return {
    id: `msg-${Date.now()}`,
    content: 'test message',
    author: {
      id: 'user-001',
      name: 'TestUser',
      isBot: false,
    },
    channel: {
      id: 'channel-001',
      type: 'guild',
    },
    attachments: [],
    mentionedUserIds: [],
    mentionedUsers: [],
    mentionedBot: true, // AI plugin expects mentions
    timestamp: new Date(),
    platform: 'discord',
    ...overrides,
  };
}
