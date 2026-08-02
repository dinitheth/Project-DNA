import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../events/event-bus.js';

interface TestEventMap {
  greet: { name: string };
  count: { value: number };
}

describe('EventBus', () => {
  it('should emit and receive events', () => {
    const bus = new EventBus<TestEventMap>();
    const handler = vi.fn();

    bus.on('greet', handler);
    bus.emit('greet', { name: 'DNA' });

    expect(handler).toHaveBeenCalledWith({ name: 'DNA' });
  });

  it('should support multiple listeners', () => {
    const bus = new EventBus<TestEventMap>();
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    bus.on('greet', handler1);
    bus.on('greet', handler2);
    bus.emit('greet', { name: 'test' });

    expect(handler1).toHaveBeenCalledOnce();
    expect(handler2).toHaveBeenCalledOnce();
  });

  it('should unsubscribe via returned function', () => {
    const bus = new EventBus<TestEventMap>();
    const handler = vi.fn();

    const unsubscribe = bus.on('greet', handler);
    unsubscribe();
    bus.emit('greet', { name: 'test' });

    expect(handler).not.toHaveBeenCalled();
  });

  it('should support once()', () => {
    const bus = new EventBus<TestEventMap>();
    const handler = vi.fn();

    bus.once('count', handler);
    bus.emit('count', { value: 1 });
    bus.emit('count', { value: 2 });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({ value: 1 });
  });

  it('should support off()', () => {
    const bus = new EventBus<TestEventMap>();
    const handler = vi.fn();

    bus.on('greet', handler);
    bus.off('greet', handler);
    bus.emit('greet', { name: 'test' });

    expect(handler).not.toHaveBeenCalled();
  });

  it('should clear specific event listeners', () => {
    const bus = new EventBus<TestEventMap>();
    const greetHandler = vi.fn();
    const countHandler = vi.fn();

    bus.on('greet', greetHandler);
    bus.on('count', countHandler);
    bus.clear('greet');

    bus.emit('greet', { name: 'test' });
    bus.emit('count', { value: 1 });

    expect(greetHandler).not.toHaveBeenCalled();
    expect(countHandler).toHaveBeenCalledOnce();
  });

  it('should clear all listeners', () => {
    const bus = new EventBus<TestEventMap>();
    bus.on('greet', vi.fn());
    bus.on('count', vi.fn());
    bus.clear();

    expect(bus.listenerCount('greet')).toBe(0);
    expect(bus.listenerCount('count')).toBe(0);
  });

  it('should report listener count', () => {
    const bus = new EventBus<TestEventMap>();
    expect(bus.listenerCount('greet')).toBe(0);

    bus.on('greet', vi.fn());
    bus.on('greet', vi.fn());
    expect(bus.listenerCount('greet')).toBe(2);
  });

  it('should not throw when emitting with no listeners', () => {
    const bus = new EventBus<TestEventMap>();
    expect(() => bus.emit('greet', { name: 'test' })).not.toThrow();
  });
});
