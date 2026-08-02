/**
 * Lightweight, typed dependency injection container.
 *
 * Design decisions:
 * - Symbol-based tokens for zero-collision, type-safe resolution.
 * - No decorators or reflect-metadata — keeps bundle size minimal for VS Code extensions.
 * - Supports singleton and transient lifetimes.
 * - Explicit registration over implicit convention — every dependency is visible.
 *
 * @example
 * ```ts
 * const container = new Container();
 * container.register(TOKENS.Logger, () => createLogger('app'), 'singleton');
 * const logger = container.resolve(TOKENS.Logger);
 * ```
 */

/** Lifetime of a registered dependency. */
export type Lifetime = 'singleton' | 'transient';

/** Internal registration record. */
export interface Registration<T = unknown> {
  factory: (container: Container) => T;
  lifetime: Lifetime;
  instance?: T;
}

export class Container {
  private readonly registrations = new Map<symbol, Registration>();

  /**
   * Register a dependency factory under a token.
   *
   * @param token - Unique symbol identifying the dependency.
   * @param factory - Factory function that receives the container for recursive resolution.
   * @param lifetime - 'singleton' caches after first resolution; 'transient' creates new each time.
   */
  register<T>(token: symbol, factory: (container: Container) => T, lifetime: Lifetime = 'singleton'): void {
    this.registrations.set(token, { factory, lifetime } as Registration);
  }

  /**
   * Resolve a dependency by its token.
   *
   * @throws Error if the token has not been registered.
   */
  resolve<T>(token: symbol): T {
    const registration = this.registrations.get(token);
    if (!registration) {
      throw new Error(
        `[Container] No registration found for token: ${token.toString()}. ` +
        `Did you forget to call container.register()?`
      );
    }

    if (registration.lifetime === 'singleton') {
      if (registration.instance === undefined) {
        registration.instance = registration.factory(this);
      }
      return registration.instance as T;
    }

    return registration.factory(this) as T;
  }

  /**
   * Check whether a token has been registered.
   */
  has(token: symbol): boolean {
    return this.registrations.has(token);
  }

  /**
   * Remove a registration and its cached instance.
   */
  unregister(token: symbol): void {
    this.registrations.delete(token);
  }

  /**
   * Clear all registrations. Useful for testing.
   */
  reset(): void {
    this.registrations.clear();
  }
}
