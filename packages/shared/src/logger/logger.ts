/**
 * Logger abstraction with Pino-based factory.
 *
 * Design decisions:
 * - Thin interface over Pino to avoid leaking the Pino API everywhere.
 * - Child loggers get automatic context (engine name, module, etc.).
 * - Log level is configurable at creation time.
 * - Silent mode for testing.
 */

import pino from 'pino';

/** Log severity levels. */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent';

/** Logger interface — engines depend on this, never on Pino directly. */
export interface Logger {
  trace(msg: string, ...args: unknown[]): void;
  debug(msg: string, ...args: unknown[]): void;
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
  fatal(msg: string, ...args: unknown[]): void;
  child(bindings: Record<string, unknown>): Logger;
}

export interface LoggerOptions {
  /** Name used as the logger context. */
  name: string;
  /** Minimum log level. Defaults to 'info'. */
  level?: LogLevel;
}

/**
 * Create a new logger instance.
 *
 * @param options - Logger configuration.
 * @returns A Logger instance backed by Pino.
 */
export function createLogger(options: LoggerOptions): Logger {
  const pinoInstance = pino({
    name: options.name,
    level: options.level ?? 'info',
    transport:
      process.env['NODE_ENV'] !== 'production'
        ? { target: 'pino/file', options: { destination: 1 } }
        : undefined,
  });

  return wrapPino(pinoInstance);
}

/**
 * Create a silent logger for testing.
 */
export function createSilentLogger(): Logger {
  return wrapPino(pino({ level: 'silent' }));
}

/** Wrap a Pino instance to conform to our Logger interface. */
function wrapPino(instance: pino.Logger): Logger {
  return {
    trace: (msg, ...args) => instance.trace(args.length > 0 ? (args[0] as object) : {}, msg),
    debug: (msg, ...args) => instance.debug(args.length > 0 ? (args[0] as object) : {}, msg),
    info: (msg, ...args) => instance.info(args.length > 0 ? (args[0] as object) : {}, msg),
    warn: (msg, ...args) => instance.warn(args.length > 0 ? (args[0] as object) : {}, msg),
    error: (msg, ...args) => instance.error(args.length > 0 ? (args[0] as object) : {}, msg),
    fatal: (msg, ...args) => instance.fatal(args.length > 0 ? (args[0] as object) : {}, msg),
    child: (bindings) => wrapPino(instance.child(bindings)),
  };
}
