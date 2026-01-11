/**
 * LLM Client unit tests
 */

import { beforeEach, describe, expect, test } from 'bun:test';
import { type ChatMessage, createOpenRouterClient, LLMClient, type Tool } from '@core';

describe('LLMClient', () => {
  describe('constructor', () => {
    test('should use OpenRouter defaults', () => {
      const client = createOpenRouterClient('test-key');
      expect(client).toBeInstanceOf(LLMClient);
    });

    test('should allow custom base URL', () => {
      const client = new LLMClient({
        apiKey: 'test-key',
        baseUrl: 'https://custom.api.com/v1',
      });
      expect(client).toBeInstanceOf(LLMClient);
    });
  });

  describe('chat()', () => {
    let client: LLMClient;
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
      client = new LLMClient({
        apiKey: 'test-key',
        baseUrl: 'https://test.api.com/v1',
      });
      originalFetch = globalThis.fetch;
    });

    test('should send correct request format', async () => {
      let capturedRequest: { url: string; options: RequestInit } | null = null;

      // @ts-expect-error - mocking fetch
      globalThis.fetch = async (url: string, options: RequestInit) => {
        capturedRequest = { url, options };
        return {
          ok: true,
          json: async () => ({
            id: 'test-id',
            model: 'test-model',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'Hello!' },
                finish_reason: 'stop',
              },
            ],
          }),
        };
      };

      await client.chat({
        messages: [{ role: 'user', content: 'Hi' }],
      });

      expect(capturedRequest).not.toBeNull();
      expect(capturedRequest!.url).toBe('https://test.api.com/v1/chat/completions');
      expect(capturedRequest!.options.method).toBe('POST');

      const body = JSON.parse(capturedRequest!.options.body as string);
      expect(body.messages).toEqual([{ role: 'user', content: 'Hi' }]);

      globalThis.fetch = originalFetch;
    });

    test('should include authorization header', async () => {
      let capturedHeaders: Record<string, string> = {};

      // @ts-expect-error - mocking fetch
      globalThis.fetch = async (_url: string, options: RequestInit) => {
        capturedHeaders = options.headers as Record<string, string>;
        return {
          ok: true,
          json: async () => ({
            id: 'test-id',
            model: 'test-model',
            choices: [{ index: 0, message: { role: 'assistant', content: 'Hi' }, finish_reason: 'stop' }],
          }),
        };
      };

      await client.chat({ messages: [{ role: 'user', content: 'Hi' }] });

      expect(capturedHeaders.Authorization).toBe('Bearer test-key');

      globalThis.fetch = originalFetch;
    });

    test('should throw on API error', async () => {
      // @ts-expect-error - mocking fetch
      globalThis.fetch = async () => ({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      });

      await expect(client.chat({ messages: [{ role: 'user', content: 'Hi' }] })).rejects.toThrow(
        'LLM API error (401): Unauthorized',
      );

      globalThis.fetch = originalFetch;
    });

    test('should include tools when provided', async () => {
      let capturedBody: Record<string, unknown> = {};

      // @ts-expect-error - mocking fetch
      globalThis.fetch = async (_url: string, options: RequestInit) => {
        capturedBody = JSON.parse(options.body as string);
        return {
          ok: true,
          json: async () => ({
            id: 'test-id',
            model: 'test-model',
            choices: [{ index: 0, message: { role: 'assistant', content: 'Hi' }, finish_reason: 'stop' }],
          }),
        };
      };

      await client.chat({
        messages: [{ role: 'user', content: 'Hi' }],
        tools: [
          {
            type: 'function',
            function: {
              name: 'get_weather',
              description: 'Get the weather',
              parameters: { type: 'object', properties: {} },
            },
          },
        ],
      });

      expect(capturedBody.tools).toHaveLength(1);
      expect((capturedBody.tools as any)[0].function.name).toBe('get_weather');

      globalThis.fetch = originalFetch;
    });
  });

  describe('complete()', () => {
    test('should return response content', async () => {
      const client = new LLMClient({
        apiKey: 'test-key',
        baseUrl: 'https://test.api.com/v1',
      });

      // @ts-expect-error - mocking fetch
      globalThis.fetch = async () => ({
        ok: true,
        json: async () => ({
          id: 'test-id',
          model: 'test-model',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'Hello there!' },
              finish_reason: 'stop',
            },
          ],
        }),
      });

      const response = await client.complete('Say hello');
      expect(response).toBe('Hello there!');
    });

    test('should include system message when provided', async () => {
      const client = new LLMClient({
        apiKey: 'test-key',
        baseUrl: 'https://test.api.com/v1',
      });

      let capturedMessages: ChatMessage[] = [];

      // @ts-expect-error - mocking fetch
      globalThis.fetch = async (_url: string, options: RequestInit) => {
        const body = JSON.parse(options.body as string);
        capturedMessages = body.messages;
        return {
          ok: true,
          json: async () => ({
            id: 'test-id',
            model: 'test-model',
            choices: [{ index: 0, message: { role: 'assistant', content: 'Hi' }, finish_reason: 'stop' }],
          }),
        };
      };

      await client.complete('Hello', { system: 'You are helpful' });

      expect(capturedMessages).toHaveLength(2);
      expect(capturedMessages[0]?.role).toBe('system');
      expect(capturedMessages[0]?.content).toBe('You are helpful');
    });
  });

  describe('toolsToDefinitions()', () => {
    test('should convert Tool[] to ToolDefinition[]', () => {
      const tools: Tool[] = [
        {
          metadata: {
            name: 'test_tool',
            description: 'Test tool',
            version: '1.0.0',
            author: 'Test',
            keywords: ['test'],
            category: 'utility',
            priority: 5,
          },
          schema: {
            type: 'function',
            name: 'test_tool',
            description: 'A test tool',
            parameters: {
              type: 'object',
              properties: {
                query: { type: 'string', description: 'Query' },
              },
              required: ['query'],
            },
            strict: true,
          },
          execute: async () => ({ success: true }),
        },
      ];

      const definitions = LLMClient.toolsToDefinitions(tools);

      expect(definitions).toHaveLength(1);
      expect(definitions[0]).toEqual({
        type: 'function',
        function: {
          name: 'test_tool',
          description: 'A test tool',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Query' },
            },
            required: ['query'],
          },
          strict: true,
        },
      });
    });
  });
});
