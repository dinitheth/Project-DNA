/**
 * IStoragePort — Abstract storage interface (Repository Pattern).
 *
 * Implementations persist DNA analysis results. The initial implementation
 * uses SQLite (better-sqlite3), but this port allows future backends
 * (IndexedDB, PostgreSQL, etc.) without changing engine code.
 */

import type { Result } from '@project-dna/shared';

/** A value write or key deletion executed as part of an atomic storage batch. */
export type StorageMutation =
  | {
      readonly type: 'save';
      readonly namespace: string;
      readonly key: string;
      readonly data: unknown;
    }
  | {
      readonly type: 'delete';
      readonly namespace: string;
      readonly key: string;
    };

/** A condition that must remain true when an atomic storage batch begins. */
export type StoragePrecondition =
  | {
      readonly type: 'missing';
      readonly namespace: string;
      readonly key: string;
    }
  | {
      readonly type: 'equals';
      readonly namespace: string;
      readonly key: string;
      readonly data: unknown;
    }
  | {
      /** Compare the exact persisted representation when JSON decoding is impossible. */
      readonly type: 'raw-equals';
      readonly namespace: string;
      readonly key: string;
      readonly value: string;
    };

/** Raw persisted record evidence exposed only by storage adapters that can preserve it safely. */
export interface StorageRecordEvidence {
  readonly value: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** A deterministic set of preconditions and mutations committed as one unit. */
export interface StorageBatch {
  readonly preconditions?: readonly StoragePrecondition[];
  readonly mutations: readonly StorageMutation[];
}

/** Raised when stored state no longer satisfies an atomic batch precondition. */
export class StorageConflictError extends Error {
  constructor(
    public readonly namespace: string,
    public readonly key: string,
  ) {
    super(`Stored value changed before atomic update: ${namespace}/${key}`);
    this.name = 'StorageConflictError';
  }
}

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

/**
 * Additive storage capability for implementations that can commit a group of
 * mutations atomically. Existing IStoragePort implementations remain valid.
 */
export interface ITransactionalStoragePort extends IStoragePort {
  /**
   * Validate all preconditions and apply every mutation within one transaction.
   * No mutation may remain visible when the operation returns an error.
   */
  applyAtomically(batch: StorageBatch): Promise<Result<void>>;
}

/** Additive forensic capability for inspecting an exact stored representation and metadata. */
export interface IStorageInspectionPort extends IStoragePort {
  inspect(namespace: string, key: string): Promise<Result<StorageRecordEvidence>>;
}
