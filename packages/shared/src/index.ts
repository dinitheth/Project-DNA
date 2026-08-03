// ─── Dependency Injection ──────────────────────────────────────────
export { Container } from './di/container.js';
export type { Lifetime, Registration } from './di/container.js';
export { TOKENS } from './di/tokens.js';

// ─── Event Bus ─────────────────────────────────────────────────────
export { EventBus } from './events/event-bus.js';
export type { DNAEventMap } from './events/dna-events.js';
export { DNAEventNames } from './events/dna-events.js';

// ─── Result Type ───────────────────────────────────────────────────
export { Ok, Err, isOk, isErr } from './result/result.js';
export type { Result } from './result/result.js';

// ─── Logger ────────────────────────────────────────────────────────
export { createLogger, createSilentLogger } from './logger/logger.js';
export type { Logger } from './logger/logger.js';

// ─── Protocol ──────────────────────────────────────────────────────
export type { ExtensionMessage, WebviewMessage, MessageEnvelope } from './protocol/messages.js';
export { ExtensionMessageSchema, WebviewMessageSchema } from './protocol/messages.js';

// ─── Constants ─────────────────────────────────────────────────────
export {
  SUPPORTED_LANGUAGES,
  DEFAULT_IGNORE_PATTERNS,
  FILE_SIZE_LIMIT_BYTES,
  EXTENSION_ID,
  COMMAND_IDS,
  VIEW_IDS,
} from './constants.js';

// ─── Common Types ──────────────────────────────────────────────────
export type {
  FilePath,
  RelativePath,
  Hash,
  Timestamp,
  LanguageId,
  Disposable,
} from './types/common.js';
