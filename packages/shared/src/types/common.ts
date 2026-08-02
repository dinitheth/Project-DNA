/**
 * Common type aliases used across all packages.
 *
 * These branded types improve readability and make function signatures
 * self-documenting. While they're currently simple aliases, they can be
 * upgraded to branded/nominal types in the future for stricter safety.
 */

/** Absolute file system path. */
export type FilePath = string;

/** Path relative to the repository root. */
export type RelativePath = string;

/** Content hash (SHA-256 hex string). */
export type Hash = string;

/** Unix timestamp in milliseconds. */
export type Timestamp = number;

/** Language identifier (e.g., 'typescript', 'python'). */
export type LanguageId = string;

/** A resource that can be disposed/cleaned up. */
export interface Disposable {
  dispose(): void;
}
