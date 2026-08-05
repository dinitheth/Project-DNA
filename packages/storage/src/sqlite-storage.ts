/**
 * @module SqliteStorage
 * SQLite implementation for DNA storage.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
  StorageConflictError,
  type IStorageInspectionPort,
  type ITransactionalStoragePort,
  type StorageBatch,
  type StorageMutation,
  type StoragePrecondition,
} from '@project-dna/dna-core';
import { Err, Ok, type Logger, type Result } from '@project-dna/shared';
import { migrate, validateDatabaseForMigration } from './migrations/index.js';

interface StoredRow {
  readonly value: string;
}

interface StoredEvidenceRow extends StoredRow {
  readonly created_at: number;
  readonly updated_at: number;
}

interface KeyRow {
  readonly key: string;
}

type PreparedMutation =
  | {
      readonly type: 'save';
      readonly namespace: string;
      readonly key: string;
      readonly value: string;
    }
  | {
      readonly type: 'delete';
      readonly namespace: string;
      readonly key: string;
    };

type PreparedPrecondition =
  | {
      readonly type: 'missing';
      readonly namespace: string;
      readonly key: string;
    }
  | {
      readonly type: 'equals';
      readonly namespace: string;
      readonly key: string;
      readonly value: string;
    }
  | {
      readonly type: 'raw-equals';
      readonly namespace: string;
      readonly key: string;
      readonly value: string;
    };

interface PreparedBatch {
  readonly preconditions: readonly PreparedPrecondition[];
  readonly mutations: readonly PreparedMutation[];
}

export class SqliteStorage implements ITransactionalStoragePort, IStorageInspectionPort {
  private readonly database: Database.Database;
  private closed = false;

  constructor(
    dbPath: string,
    private readonly logger: Logger,
  ) {
    if (dbPath !== ':memory:') {
      mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
    }

    const database = new Database(dbPath);
    try {
      database.pragma('foreign_keys = ON');
      database.pragma('busy_timeout = 5000');
      validateDatabaseForMigration(database);
      migrate(database);
      if (dbPath !== ':memory:') database.pragma('journal_mode = WAL');
    } catch (error) {
      database.close();
      throw error;
    }
    this.database = database;
    this.logger.info(`SQLite storage opened at ${dbPath}`);
  }

  public async save<T>(namespace: string, key: string, data: T): Promise<Result<void>> {
    try {
      this.assertOpen();
      this.executeBatch(this.prepareBatch({ mutations: [{ type: 'save', namespace, key, data }] }));
      return Ok(undefined);
    } catch (error) {
      return this.storageError('save', namespace, key, error);
    }
  }

  public async load<T>(namespace: string, key: string): Promise<Result<T>> {
    try {
      this.assertOpen();
      const row = this.database
        .prepare('SELECT value FROM dna_store WHERE namespace = ? AND key = ?')
        .get(namespace, key) as StoredRow | undefined;
      if (!row) return Err(new Error(`Stored value not found: ${namespace}/${key}`));
      return Ok(JSON.parse(row.value) as T);
    } catch (error) {
      return this.storageError('load', namespace, key, error);
    }
  }

  public async delete(namespace: string, key: string): Promise<Result<void>> {
    try {
      this.assertOpen();
      this.executeBatch(this.prepareBatch({ mutations: [{ type: 'delete', namespace, key }] }));
      return Ok(undefined);
    } catch (error) {
      return this.storageError('delete', namespace, key, error);
    }
  }

  public async inspect(
    namespace: string,
    key: string,
  ): Promise<Result<{ value: string; createdAt: number; updatedAt: number }>> {
    try {
      this.assertOpen();
      const row = this.database
        .prepare(
          'SELECT value, created_at, updated_at FROM dna_store WHERE namespace = ? AND key = ?',
        )
        .get(namespace, key) as StoredEvidenceRow | undefined;
      if (!row) return Err(new Error(`Stored value not found: ${namespace}/${key}`));
      return Ok({ value: row.value, createdAt: row.created_at, updatedAt: row.updated_at });
    } catch (error) {
      return this.storageError('inspect', namespace, key, error);
    }
  }

  public async applyAtomically(batch: StorageBatch): Promise<Result<void>> {
    try {
      this.assertOpen();
      this.executeBatch(this.prepareBatch(batch));
      return Ok(undefined);
    } catch (error) {
      if (error instanceof StorageConflictError) {
        this.logger.warn(error.message);
        return Err(error);
      }
      return this.storageError('apply atomic batch to', 'transaction', '*', error);
    }
  }

  public async exists(namespace: string, key: string): Promise<Result<boolean>> {
    try {
      this.assertOpen();
      const row = this.database
        .prepare('SELECT 1 FROM dna_store WHERE namespace = ? AND key = ?')
        .get(namespace, key);
      return Ok(row !== undefined);
    } catch (error) {
      return this.storageError('check', namespace, key, error);
    }
  }

  public async list(namespace: string): Promise<Result<string[]>> {
    try {
      this.assertOpen();
      const rows = this.database
        .prepare('SELECT key FROM dna_store WHERE namespace = ? ORDER BY key ASC')
        .all(namespace) as KeyRow[];
      return Ok(rows.map((row) => row.key));
    } catch (error) {
      return this.storageError('list', namespace, '*', error);
    }
  }

  public async close(): Promise<void> {
    if (this.closed) return;
    this.database.close();
    this.closed = true;
    this.logger.info('SQLite storage closed');
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('SQLite storage is closed');
  }

  private prepareBatch(batch: StorageBatch): PreparedBatch {
    const preconditions = batch.preconditions?.map((item) => this.preparePrecondition(item)) ?? [];
    const mutations = batch.mutations.map((item) => this.prepareMutation(item));
    assertUniqueEntries(preconditions, 'precondition');
    assertUniqueEntries(mutations, 'mutation');
    return { preconditions, mutations };
  }

  private preparePrecondition(precondition: StoragePrecondition): PreparedPrecondition {
    if (precondition.type === 'missing' || precondition.type === 'raw-equals') {
      return precondition;
    }
    return { ...precondition, value: serialize(precondition.data) };
  }

  private prepareMutation(mutation: StorageMutation): PreparedMutation {
    return mutation.type === 'delete'
      ? mutation
      : {
          type: 'save',
          namespace: mutation.namespace,
          key: mutation.key,
          value: serialize(mutation.data),
        };
  }

  private executeBatch(batch: PreparedBatch): void {
    const read = this.database.prepare(
      'SELECT value FROM dna_store WHERE namespace = ? AND key = ?',
    );
    const save = this.database.prepare(
      `INSERT INTO dna_store (namespace, key, value, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(namespace, key) DO UPDATE SET
         value = excluded.value,
         updated_at = excluded.updated_at`,
    );
    const remove = this.database.prepare('DELETE FROM dna_store WHERE namespace = ? AND key = ?');
    const execute = this.database.transaction(() => {
      for (const precondition of batch.preconditions) {
        const row = read.get(precondition.namespace, precondition.key) as StoredRow | undefined;
        const satisfied =
          precondition.type === 'missing'
            ? row === undefined
            : row !== undefined && row.value === precondition.value;
        if (!satisfied) {
          throw new StorageConflictError(precondition.namespace, precondition.key);
        }
      }

      const now = Date.now();
      for (const mutation of batch.mutations) {
        if (mutation.type === 'save') {
          save.run(mutation.namespace, mutation.key, mutation.value, now, now);
        } else {
          remove.run(mutation.namespace, mutation.key);
        }
      }
    });
    execute.immediate();
  }

  private storageError<T>(
    operation: string,
    namespace: string,
    key: string,
    error: unknown,
  ): Result<T> {
    const cause = error instanceof Error ? error : new Error(String(error));
    const resolved = new Error(
      `Failed to ${operation} stored value ${namespace}/${key}: ${cause.message}`,
      { cause },
    );
    this.logger.error(resolved.message);
    return Err(resolved);
  }
}

function serialize(data: unknown): string {
  const value = JSON.stringify(data);
  if (value === undefined) throw new Error('Value is not JSON-serializable');
  return value;
}

function assertUniqueEntries(
  entries: readonly { readonly namespace: string; readonly key: string }[],
  kind: string,
): void {
  const identities = new Set<string>();
  for (const entry of entries) {
    const identity = JSON.stringify([entry.namespace, entry.key]);
    if (identities.has(identity)) {
      throw new Error(
        `Atomic storage batch contains duplicate ${kind}: ${entry.namespace}/${entry.key}`,
      );
    }
    identities.add(identity);
  }
}
