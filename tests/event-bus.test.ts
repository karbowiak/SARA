/**
 * EventBus unit tests
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { AutocompleteRequest, BotMessage, ButtonInteraction } from '@core';
import { createEventBus, EventBus } from '@core';

describe('EventBus', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = createEventBus();
  });

  describe('on() and emit()', () => {
    test('should call handler when event is emitted', async () => {
      let received: BotMessage | null = null;

      bus.on('message:received', (msg) => {
        received = msg;
      });

      const testMessage = createTestMessage('Hello!');
      await bus.emit('message:received', testMessage);

      expect(received).not.toBeNull();
      expect(received!.content).toBe('Hello!');
    });

    test('should call handler multiple times for multiple emits', async () => {
      let callCount = 0;

      bus.on('bot:ready', () => {
        callCount++;
      });

      await bus.emit('bot:ready', { platform: 'test' });
      await bus.emit('bot:ready', { platform: 'test' });
      await bus.emit('bot:ready', { platform: 'test' });

      expect(callCount).toBe(3);
    });

    test('should call all handlers for same event', async () => {
      const results: string[] = [];

      bus.on('command:received', () => {
        results.push('handler1');
      });
      bus.on('command:received', () => {
        results.push('handler2');
      });
      bus.on('command:received', () => {
        results.push('handler3');
      });

      await bus.emit('command:received', createTestCommand());

      expect(results).toHaveLength(3);
      expect(results).toContain('handler1');
      expect(results).toContain('handler2');
      expect(results).toContain('handler3');
    });

    test('should handle async handlers', async () => {
      let resolved = false;

      bus.on('message:received', async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        resolved = true;
      });

      await bus.emit('message:received', createTestMessage('async test'));

      expect(resolved).toBe(true);
    });

    test('should not call handlers for different events', async () => {
      let called = false;

      bus.on('bot:ready', () => {
        called = true;
      });

      await bus.emit('bot:shutdown', {});

      expect(called).toBe(false);
    });
  });

  describe('once()', () => {
    test('should call handler only once', async () => {
      let callCount = 0;

      bus.once('bot:ready', () => {
        callCount++;
      });

      await bus.emit('bot:ready', { platform: 'test' });
      await bus.emit('bot:ready', { platform: 'test' });
      await bus.emit('bot:ready', { platform: 'test' });

      expect(callCount).toBe(1);
    });

    test('should auto-remove handler after first call', async () => {
      bus.once('bot:ready', () => {});

      expect(bus.listenerCount('bot:ready')).toBe(1);

      await bus.emit('bot:ready', { platform: 'test' });

      expect(bus.listenerCount('bot:ready')).toBe(0);
    });
  });

  describe('off()', () => {
    test('should remove handler', async () => {
      let callCount = 0;
      const handler = () => {
        callCount++;
      };

      bus.on('bot:shutdown', handler);

      await bus.emit('bot:shutdown', {});
      expect(callCount).toBe(1);

      bus.off('bot:shutdown', handler);

      await bus.emit('bot:shutdown', {});
      expect(callCount).toBe(1); // Still 1, not 2
    });

    test('should only remove specific handler', async () => {
      const results: string[] = [];
      const handler1 = () => {
        results.push('h1');
      };
      const handler2 = () => {
        results.push('h2');
      };

      bus.on('bot:ready', handler1);
      bus.on('bot:ready', handler2);

      bus.off('bot:ready', handler1);

      await bus.emit('bot:ready', { platform: 'test' });

      expect(results).toEqual(['h2']);
    });

    test('should do nothing if handler not found', () => {
      const handler = () => {};

      // Should not throw
      bus.off('bot:ready', handler);
      expect(bus.listenerCount('bot:ready')).toBe(0);
    });
  });

  describe('error isolation', () => {
    test('should continue calling other handlers when one throws', async () => {
      const results: string[] = [];

      bus.on('reaction:added', () => {
        throw new Error('Intentional test error');
      });

      bus.on('reaction:added', () => {
        results.push('second handler ran');
      });

      // Should not throw
      await bus.emit('reaction:added', createTestReaction());

      expect(results).toContain('second handler ran');
    });

    test('should emit plugin:error when handler throws', async () => {
      let errorEvent: { pluginId: string; error: Error } | null = null;

      bus.on('plugin:error', (payload) => {
        errorEvent = payload;
      });

      bus.on('reaction:added', () => {
        throw new Error('Test error message');
      });

      await bus.emit('reaction:added', createTestReaction());

      expect(errorEvent).not.toBeNull();
      expect(errorEvent!.error.message).toBe('Test error message');
    });

    test('should handle async handler errors', async () => {
      let otherHandlerRan = false;

      bus.on('message:received', async () => {
        await Promise.reject(new Error('Async error'));
      });

      bus.on('message:received', () => {
        otherHandlerRan = true;
      });

      await bus.emit('message:received', createTestMessage('test'));

      expect(otherHandlerRan).toBe(true);
    });
  });

  describe('fire()', () => {
    test('should emit without waiting for handlers', () => {
      let completed = false;

      bus.on('bot:ready', async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        completed = true;
      });

      bus.fire('bot:ready', { platform: 'test' });

      // Handler hasn't completed yet because fire() doesn't wait
      expect(completed).toBe(false);
    });
  });

  describe('listenerCount()', () => {
    test('should return 0 for events with no listeners', () => {
      expect(bus.listenerCount('bot:ready')).toBe(0);
    });

    test('should return correct count', () => {
      bus.on('message:received', () => {});
      bus.on('message:received', () => {});
      bus.on('message:received', () => {});

      expect(bus.listenerCount('message:received')).toBe(3);
    });
  });

  describe('removeAllListeners()', () => {
    test('should remove all listeners for specific event', () => {
      bus.on('bot:ready', () => {});
      bus.on('bot:ready', () => {});
      bus.on('bot:shutdown', () => {});

      bus.removeAllListeners('bot:ready');

      expect(bus.listenerCount('bot:ready')).toBe(0);
      expect(bus.listenerCount('bot:shutdown')).toBe(1);
    });

    test('should remove all listeners when no event specified', () => {
      bus.on('bot:ready', () => {});
      bus.on('bot:shutdown', () => {});
      bus.on('message:received', () => {});

      bus.removeAllListeners();

      expect(bus.listenerCount('bot:ready')).toBe(0);
      expect(bus.listenerCount('bot:shutdown')).toBe(0);
      expect(bus.listenerCount('message:received')).toBe(0);
    });
  });

  describe('eventNames()', () => {
    test('should return empty array when no listeners', () => {
      expect(bus.eventNames()).toEqual([]);
    });

    test('should return all event names with listeners', () => {
      bus.on('bot:ready', () => {});
      bus.on('message:received', () => {});

      const names = bus.eventNames();

      expect(names).toHaveLength(2);
      expect(names).toContain('bot:ready');
      expect(names).toContain('message:received');
    });
  });

  describe('createEventBus()', () => {
    test('should create EventBus with default options', () => {
      const bus = createEventBus();
      expect(bus).toBeInstanceOf(EventBus);
    });

    test('should respect debug option', async () => {
      const consoleSpy = mock(() => {});
      const originalLog = console.log;
      console.log = consoleSpy;

      const debugBus = createEventBus({ debug: true });
      debugBus.on('bot:ready', () => {});
      await debugBus.emit('bot:ready', { platform: 'test' });

      console.log = originalLog;

      expect(consoleSpy).toHaveBeenCalled();
    });
  });

  describe('interaction events', () => {
    test('should handle autocomplete requests', async () => {
      let receivedRequest: AutocompleteRequest | null = null;

      bus.on('command:autocomplete', (req) => {
        receivedRequest = req;
      });

      const autocompleteRequest = createTestAutocomplete();
      await bus.emit('command:autocomplete', autocompleteRequest);

      expect(receivedRequest).not.toBeNull();
      expect(receivedRequest!.commandName).toBe('test');
      expect(receivedRequest!.focusedOption.name).toBe('query');
    });

    test('should handle button interactions', async () => {
      let receivedButton: ButtonInteraction | null = null;

      bus.on('interaction:button', (btn) => {
        receivedButton = btn;
      });

      const buttonInteraction = createTestButtonInteraction();
      await bus.emit('interaction:button', buttonInteraction);

      expect(receivedButton).not.toBeNull();
      expect(receivedButton!.customId).toBe('confirm_action');
    });

    test('should handle message updates and deletes', async () => {
      let updatedMsg: BotMessage | null = null;
      let deletedInfo: { messageId: string; channelId: string } | null = null;

      bus.on('message:updated', (msg) => {
        updatedMsg = msg;
      });

      bus.on('message:deleted', (info) => {
        deletedInfo = info;
      });

      await bus.emit('message:updated', createTestMessage('edited content'));
      await bus.emit('message:deleted', {
        messageId: 'msg-123',
        channelId: 'channel-001',
        platform: 'test',
      });

      expect(updatedMsg).not.toBeNull();
      expect(updatedMsg!.content).toBe('edited content');
      expect(deletedInfo).not.toBeNull();
      expect(deletedInfo!.messageId).toBe('msg-123');
    });
  });
});

// Helper functions

function createTestMessage(content: string): BotMessage {
  return {
    id: `msg-${Date.now()}`,
    content,
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
    mentionedBot: false,
    timestamp: new Date(),
    platform: 'test',
  };
}

function createTestCommand() {
  return {
    commandName: 'test',
    args: {},
    user: { id: '1', name: 'Test', isBot: false },
    channel: { id: '1', type: 'guild' as const },
    platform: 'test' as const,
    reply: async () => {},
    defer: async () => {},
    followUp: async () => {},
  };
}

function createTestReaction() {
  return {
    messageId: 'msg-001',
    channelId: 'channel-001',
    emoji: '👍',
    userId: 'user-001',
    platform: 'test' as const,
  };
}

function createTestAutocomplete(): AutocompleteRequest {
  return {
    commandName: 'test',
    focusedOption: {
      name: 'query',
      value: 'search term',
    },
    options: {},
    user: { id: '1', name: 'Test', isBot: false },
    channel: { id: '1', type: 'guild' as const },
    platform: 'test' as const,
    respond: async () => {},
  };
}

function createTestButtonInteraction(): ButtonInteraction {
  return {
    customId: 'confirm_action',
    user: { id: '1', name: 'Test', isBot: false },
    channel: { id: '1', type: 'guild' as const },
    messageId: 'msg-001',
    platform: 'test' as const,
    update: async () => {},
    deferUpdate: async () => {},
    reply: async () => {},
  };
}
