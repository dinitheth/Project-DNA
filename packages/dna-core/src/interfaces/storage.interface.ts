/**
 * IStoragePort — Abstract storage interface (Repository Pattern).
 *
 * Implementations persist DNA analysis results. The initial implementation
 * uses SQLite (better-sqlite3), but this port allows future backends
 * (IndexedDB, PostgreSQL, etc.) without changing engine code.
 */

import type { Result } from '@project-dna/shared';

export interface IStoragePort {
  /**
   * Save a value under a key with a namespace prefix.
   *
   * @param namespace - Category/type prefix (e.g., 'repository', 'file', 'knowledge').
   * @param key - Unique key within the namespace.
   * @param data - The data to persist (must be JSON-serializable).
   */
  save<T>(namespace: string, key: string, data: T): Promise<Result<void>>;

  /**
   * Load a value by namespace and key.
   *
   * @returns The stored data, or an error if not found.
   */
  load<T>(namespace: string, key: string): Promise<Result<T>>;

  /**
   * Delete a value by namespace and key.
   */
  delete(namespace: string, key: string): Promise<Result<void>>;

  /**
   * Check if a value exists.
   */
  exists(namespace: string, key: string): Promise<Result<boolean>>;

  /**
   * List all keys in a namespace.
   */
  list(namespace: string): Promise<Result<string[]>>;

  /**
   * Close the storage connection and release resources.
   */
  close(): Promise<void>;
}
