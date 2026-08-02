import { describe, it, expect, beforeEach } from 'vitest';
import { Container } from '../di/container.js';

describe('Container', () => {
  let container: Container;

  beforeEach(() => {
    container = new Container();
  });

  describe('register and resolve', () => {
    it('should resolve a registered singleton', () => {
      const token = Symbol('test');
      container.register(token, () => ({ value: 42 }), 'singleton');

      const result = container.resolve<{ value: number }>(token);
      expect(result.value).toBe(42);
    });

    it('should return the same instance for singletons', () => {
      const token = Symbol('test');
      let callCount = 0;
      container.register(
        token,
        () => {
          callCount++;
          return { id: callCount };
        },
        'singleton',
      );

      const first = container.resolve(token);
      const second = container.resolve(token);
      expect(first).toBe(second);
      expect(callCount).toBe(1);
    });

    it('should return new instances for transients', () => {
      const token = Symbol('test');
      let callCount = 0;
      container.register(
        token,
        () => {
          callCount++;
          return { id: callCount };
        },
        'transient',
      );

      const first = container.resolve<{ id: number }>(token);
      const second = container.resolve<{ id: number }>(token);
      expect(first).not.toBe(second);
      expect(first.id).toBe(1);
      expect(second.id).toBe(2);
    });

    it('should default to singleton lifetime', () => {
      const token = Symbol('test');
      let callCount = 0;
      container.register(token, () => {
        callCount++;
        return {};
      });

      container.resolve(token);
      container.resolve(token);
      expect(callCount).toBe(1);
    });

    it('should throw for unregistered tokens', () => {
      const token = Symbol('missing');
      expect(() => container.resolve(token)).toThrow('No registration found');
    });
  });

  describe('has', () => {
    it('should return true for registered tokens', () => {
      const token = Symbol('test');
      container.register(token, () => ({}));
      expect(container.has(token)).toBe(true);
    });

    it('should return false for unregistered tokens', () => {
      expect(container.has(Symbol('missing'))).toBe(false);
    });
  });

  describe('unregister', () => {
    it('should remove a registration', () => {
      const token = Symbol('test');
      container.register(token, () => ({}));
      container.unregister(token);
      expect(container.has(token)).toBe(false);
    });
  });

  describe('reset', () => {
    it('should clear all registrations', () => {
      container.register(Symbol('a'), () => ({}));
      container.register(Symbol('b'), () => ({}));
      container.reset();
      expect(container.has(Symbol('a'))).toBe(false);
    });
  });

  describe('recursive resolution', () => {
    it('should allow factories to resolve other dependencies', () => {
      const loggerToken = Symbol('logger');
      const serviceToken = Symbol('service');

      container.register(loggerToken, () => ({ log: (msg: string) => msg }));
      container.register(serviceToken, (c) => ({
        logger: c.resolve<{ log: (msg: string) => string }>(loggerToken),
      }));

      const service = container.resolve<{ logger: { log: (msg: string) => string } }>(serviceToken);
      expect(service.logger.log('hello')).toBe('hello');
    });
  });
});
