/**
 * EventBus - Type-safe pub/sub event system
 *
 * Core of the platform-agnostic architecture.
 * All communication between adapters and plugins flows through here.
 */

import type { EventHandler, EventName, EventPayload } from './types/events';

/**
 * Subscriber entry with metadata
 */
interface Subscriber<E extends EventName> {
  handler: EventHandler<E>;
  once: boolean;
}

/**
 * EventBus options
 */
export interface EventBusOptions {
  /** Max listeners per event before warning (default: 100) */
  maxListeners?: number;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Type-safe EventBus implementation
 */
export class EventBus {
  private subscribers = new Map<EventName, Set<Subscriber<any>>>();
  private options: Required<EventBusOptions>;

  constructor(options: EventBusOptions = {}) {
    this.options = {
      maxListeners: options.maxListeners ?? 100,
      debug: options.debug ?? false,
    };
  }

  /**
   * Subscribe to an event
   */
  on<E extends EventName>(event: E, handler: EventHandler<E>): void {
    this.addSubscriber(event, { handler, once: false });
  }

  /**
   * Subscribe to an event (fires once then auto-unsubscribes)
   */
  once<E extends EventName>(event: E, handler: EventHandler<E>): void {
    this.addSubscriber(event, { handler, once: true });
  }

  /**
   * Unsubscribe from an event
   */
  off<E extends EventName>(event: E, handler: EventHandler<E>): void {
    const subs = this.subscribers.get(event);
    if (!subs) return;

    for (const sub of subs) {
      if (sub.handler === handler) {
        subs.delete(sub);
        break;
      }
    }
  }

  /**
   * Emit an event to all subscribers
   *
   * Handlers are called in parallel. Errors in one handler don't affect others.
   */
  async emit<E extends EventName>(event: E, payload: EventPayload<E>): Promise<void> {
    const subs = this.subscribers.get(event);
    if (!subs || subs.size === 0) {
      if (this.options.debug) {
        console.log(`[EventBus] No handlers for event: ${event}`);
      }
      return;
    }

    if (this.options.debug) {
      console.log(`[EventBus] Emitting ${event} to ${subs.size} handler(s)`);
    }

    const toRemove: Subscriber<E>[] = [];
    const promises: Promise<void>[] = [];

    for (const sub of subs) {
      // Mark once handlers for removal
      if (sub.once) {
        toRemove.push(sub);
      }

      // Execute handler with error isolation
      const promise = this.executeHandler(event, sub.handler, payload);
      promises.push(promise);
    }

    // Remove once handlers
    for (const sub of toRemove) {
      subs.delete(sub);
    }

    // Wait for all handlers to complete
    await Promise.all(promises);
  }

  /**
   * Emit synchronously (fire-and-forget)
   *
   * Use this when you don't need to wait for handlers to complete.
   */
  fire<E extends EventName>(event: E, payload: EventPayload<E>): void {
    this.emit(event, payload).catch((err) => {
      console.error(`[EventBus] Unhandled error in fire():`, err);
    });
  }

  /**
   * Get number of subscribers for an event
   */
  listenerCount(event: EventName): number {
    return this.subscribers.get(event)?.size ?? 0;
  }

  /**
   * Remove all subscribers for an event (or all events)
   */
  removeAllListeners(event?: EventName): void {
    if (event) {
      this.subscribers.delete(event);
    } else {
      this.subscribers.clear();
    }
  }

  /**
   * Get all registered event names
   */
  eventNames(): EventName[] {
    return Array.from(this.subscribers.keys());
  }

  /**
   * Add a subscriber with listener limit check
   */
  private addSubscriber<E extends EventName>(event: E, subscriber: Subscriber<E>): void {
    let subs = this.subscribers.get(event);

    if (!subs) {
      subs = new Set();
      this.subscribers.set(event, subs);
    }

    // Warn if exceeding max listeners
    if (subs.size >= this.options.maxListeners) {
      console.warn(
        `[EventBus] Warning: Event "${event}" has ${subs.size} listeners. ` +
          `Possible memory leak. Max recommended: ${this.options.maxListeners}`,
      );
    }

    subs.add(subscriber);

    if (this.options.debug) {
      console.log(`[EventBus] Added handler for ${event} (total: ${subs.size})`);
    }
  }

  /**
   * Execute a handler with error isolation
   */
  private async executeHandler<E extends EventName>(
    event: E,
    handler: EventHandler<E>,
    payload: EventPayload<E>,
  ): Promise<void> {
    try {
      const result = handler(payload);
      if (result instanceof Promise) {
        await result;
      }
    } catch (error) {
      // Log error but don't re-throw - isolate handler failures
      console.error(`[EventBus] Handler error for event "${event}":`, error);

      // Emit plugin error event (if not already a plugin:error to avoid infinite loop)
      if (event !== 'plugin:error') {
        this.fire('plugin:error', {
          pluginId: 'unknown',
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }
  }
}

/**
 * Create a new EventBus instance
 */
export function createEventBus(options?: EventBusOptions): EventBus {
  return new EventBus(options);
}
