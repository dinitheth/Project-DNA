/**
 * @module SqliteStorage
 * SQLite implementation for DNA storage.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { IStoragePort } from '@project-dna/dna-core';
import { Err, Ok, type Logger, type Result } from '@project-dna/shared';
import { migrate } from './migrations/001-initial.js';

interface StoredRow {
  readonly value: string;
}

interface KeyRow {
  readonly key: string;
}

export class SqliteStorage implements IStoragePort {
  private readonly database: Database.Database;
  private closed = false;

  constructor(dbPath: string, private readonly logger: Logger) {
    if (dbPath !== ':memory:') {
      mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
    }

    this.database = new Database(dbPath);
    this.database.pragma('foreign_keys = ON');
    this.database.pragma('busy_timeout = 5000');
    if (dbPath !== ':memory:') this.database.pragma('journal_mode = WAL');
    migrate(this.database);
    this.logger.info(`SQLite storage opened at ${dbPath}`);
  }

  public async save<T>(namespace: string, key: string, data: T): Promise<Result<void>> {
    try {
      this.assertOpen();
      const value = JSON.stringify(data);
      if (value === undefined) throw new Error('Value is not JSON-serializable');
      const now = Date.now();
      this.database
        .prepare(
          `INSERT INTO dna_store (namespace, key, value, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(namespace, key) DO UPDATE SET
             value = excluded.value,
             updated_at = excluded.updated_at`,
        )
        .run(namespace, key, value, now, now);
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
      this.database
        .prepare('DELETE FROM dna_store WHERE namespace = ? AND key = ?')
        .run(namespace, key);
      return Ok(undefined);
    } catch (error) {
      return this.storageError('delete', namespace, key, error);
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
