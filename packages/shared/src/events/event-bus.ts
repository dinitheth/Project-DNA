/**
 * Typed event bus for cross-engine communication.
 *
 * Design decisions:
 * - Generic over an event map type for compile-time safety.
 * - No external dependencies — just a Map of Sets.
 * - Supports `on`, `off`, `once`, `emit`.
 * - Returns a Disposable from `on`/`once` for easy cleanup.
 *
 * @example
 * ```ts
 * const bus = new EventBus<DNAEventMap>();
 * const dispose = bus.on('ScanComplete', (payload) => { ... });
 * bus.emit('ScanComplete', { repositoryDna: ... });
 * dispose(); // unsubscribe
 * ```
 */

/** A function that removes a listener when called. */
export type Unsubscribe = () => void;

/** Listener function type. */
type Listener<T> = (payload: T) => void;

/** Error handler for listener failures. */
export type EventBusErrorHandler<TEventMap> = (event: keyof TEventMap, error: unknown) => void;

export class EventBus<TEventMap extends { [K in keyof TEventMap]: unknown }> {
  private readonly listeners = new Map<keyof TEventMap, Set<Listener<unknown>>>();
  private readonly errorHandler?: EventBusErrorHandler<TEventMap>;

  /**
   * @param options - Optional configuration.
   * @param options.onError - Handler called when a listener throws. If not provided, errors are logged to console.
   */
  constructor(options?: { onError?: EventBusErrorHandler<TEventMap> }) {
    this.errorHandler = options?.onError;
  }

  /**
   * Subscribe to an event.
   * @returns An unsubscribe function.
   */
  on<K extends keyof TEventMap>(event: K, listener: Listener<TEventMap[K]>): Unsubscribe {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    const set = this.listeners.get(event)!;
    set.add(listener as Listener<unknown>);

    return () => {
      set.delete(listener as Listener<unknown>);
    };
  }

  /**
   * Subscribe to an event, but only fire once.
   * @returns An unsubscribe function.
   */
  once<K extends keyof TEventMap>(event: K, listener: Listener<TEventMap[K]>): Unsubscribe {
    const unsubscribe = this.on(event, (payload) => {
      unsubscribe();
      listener(payload);
    });
    return unsubscribe;
  }

  /**
   * Unsubscribe a specific listener from an event.
   */
  off<K extends keyof TEventMap>(event: K, listener: Listener<TEventMap[K]>): void {
    const set = this.listeners.get(event);
    if (set) {
      set.delete(listener as Listener<unknown>);
    }
  }

  /**
   * Emit an event, notifying all subscribers synchronously.
   */
  emit<K extends keyof TEventMap>(event: K, payload: TEventMap[K]): void {
    const set = this.listeners.get(event);
    if (set) {
      for (const listener of set) {
        try {
          listener(payload);
        } catch (error) {
          // Error isolation: a listener failure must NEVER crash the emitter.
          // This prevents cascading failures across unrelated subsystems
          // (e.g., a UI progress handler bug killing the analysis pipeline).
          if (this.errorHandler) {
            this.errorHandler(event, error);
          } else {
            console.error(`[EventBus] Listener error on "${String(event)}":`, error);
          }
        }
      }
    }
  }

  /**
   * Remove all listeners for a specific event, or all events if none specified.
   */
  clear(event?: keyof TEventMap): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }

  /**
   * Get the count of listeners for a specific event.
   */
  listenerCount(event: keyof TEventMap): number {
    return this.listeners.get(event)?.size ?? 0;
  }
}
