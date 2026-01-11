/**
 * WebSearchTool unit tests
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { BotMessage, Logger, ToolExecutionContext } from '@core';
import { WebSearchTool } from '../app/plugins/ai/tools/web-search.tool';

describe('WebSearchTool', () => {
  let tool: WebSearchTool;

  describe('metadata', () => {
    beforeEach(() => {
      tool = new WebSearchTool('test-api-key');
    });

    test('should have correct name', () => {
      expect(tool.metadata.name).toBe('web_search');
    });

    test('should have correct category', () => {
      expect(tool.metadata.category).toBe('information');
    });

    test('should have relevant keywords', () => {
      expect(tool.metadata.keywords).toContain('search');
      expect(tool.metadata.keywords).toContain('google');
      expect(tool.metadata.keywords).toContain('web');
    });
  });

  describe('schema', () => {
    beforeEach(() => {
      tool = new WebSearchTool('test-api-key');
    });

    test('should have function type', () => {
      expect(tool.schema.type).toBe('function');
    });

    test('should require query parameter', () => {
      expect(tool.schema.parameters.required).toContain('query');
    });

    test('should have query and max_results properties', () => {
      expect(tool.schema.parameters.properties).toHaveProperty('query');
      expect(tool.schema.parameters.properties).toHaveProperty('max_results');
    });
  });

  describe('validate()', () => {
    test('should return true when API key is provided', () => {
      tool = new WebSearchTool('test-api-key');
      expect(tool.validate()).toBe(true);
    });

    test('should return false when API key is missing', () => {
      tool = new WebSearchTool(undefined);
      // Also clear env var for this test
      const originalEnv = process.env.TAVILY_API_KEY;
      delete process.env.TAVILY_API_KEY;

      tool = new WebSearchTool();
      expect(tool.validate()).toBe(false);

      // Restore
      if (originalEnv) process.env.TAVILY_API_KEY = originalEnv;
    });
  });

  describe('execute()', () => {
    let context: ToolExecutionContext;
    let logger: Logger;

    beforeEach(() => {
      logger = {
        debug: mock(() => {}),
        info: mock(() => {}),
        warn: mock(() => {}),
        error: mock(() => {}),
      };

      context = {
        message: createMessage(),
        user: { id: 'user-1', name: 'Test', isBot: false },
        channel: { id: 'channel-1', type: 'guild' },
        logger,
        eventBus: {
          on: mock(() => {}),
          off: mock(() => {}),
          emit: mock(() => Promise.resolve()),
          fire: mock(() => {}),
        } as any,
      };
    });

    test('should return error when API key is missing', async () => {
      // Save and clear env var before constructing
      const originalEnv = process.env.TAVILY_API_KEY;
      delete process.env.TAVILY_API_KEY;

      tool = new WebSearchTool(undefined);

      const result = await tool.execute({ query: 'test' }, context);

      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('configuration_error');

      // Restore
      if (originalEnv) process.env.TAVILY_API_KEY = originalEnv;
    });

    test('should call Tavily API with correct parameters', async () => {
      tool = new WebSearchTool('test-api-key');

      const originalFetch = globalThis.fetch;
      let capturedUrl = '';
      let capturedMethod = '';

      // @ts-expect-error - mocking fetch
      globalThis.fetch = async (url: string, options: RequestInit) => {
        capturedUrl = url;
        capturedMethod = options.method ?? '';
        return {
          ok: true,
          json: async () => ({
            results: [{ title: 'Result 1', url: 'https://example.com', content: 'Content 1', score: 0.9 }],
          }),
        };
      };

      const result = await tool.execute({ query: 'test query', max_results: 3 }, context);

      expect(capturedUrl).toBe('https://api.tavily.com/search');
      expect(capturedMethod).toBe('POST');

      expect(result.success).toBe(true);
      expect((result.data as any)?.query).toBe('test query');
      expect((result.data as any)?.results).toHaveLength(1);

      globalThis.fetch = originalFetch;
    });

    test('should handle API errors gracefully', async () => {
      tool = new WebSearchTool('test-api-key');

      const originalFetch = globalThis.fetch;
      // @ts-expect-error - mocking fetch
      globalThis.fetch = async () => ({
        ok: false,
        status: 500,
      });

      const result = await tool.execute({ query: 'test' }, context);

      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('execution_error');
      expect(result.error?.retryable).toBe(true);

      globalThis.fetch = originalFetch;
    });

    test('should clamp max_results between 1 and 10', async () => {
      tool = new WebSearchTool('test-api-key');

      const originalFetch = globalThis.fetch;
      let capturedBody: string = '';

      // @ts-expect-error - mocking fetch
      globalThis.fetch = async (_url: string, options: RequestInit) => {
        capturedBody = options.body as string;
        return {
          ok: true,
          json: async () => ({ results: [] }),
        };
      };

      // Test max_results > 10
      await tool.execute({ query: 'test', max_results: 20 }, context);
      expect(JSON.parse(capturedBody).max_results).toBe(10);

      // Test max_results < 1
      await tool.execute({ query: 'test', max_results: 0 }, context);
      expect(JSON.parse(capturedBody).max_results).toBe(1);

      globalThis.fetch = originalFetch;
    });
  });
});

// Helper
function createMessage(): BotMessage {
  return {
    id: 'msg-1',
    content: 'test',
    author: { id: 'user-1', name: 'Test', isBot: false },
    channel: { id: 'channel-1', type: 'guild' },
    attachments: [],
    mentionedUserIds: [],
    mentionedUsers: [],
    mentionedBot: true,
    timestamp: new Date(),
    platform: 'discord',
  };
}
