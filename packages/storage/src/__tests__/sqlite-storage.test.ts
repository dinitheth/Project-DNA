import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { StorageConflictError } from '@project-dna/dna-core';
import { createSilentLogger, isErr } from '@project-dna/shared';
import { SqliteStorage } from '../sqlite-storage.js';
import {
  CURRENT_SCHEMA_VERSION,
  migrate,
  validateDatabaseForMigration,
} from '../migrations/index.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('SqliteStorage', () => {
  it('supports namespaced CRUD, upserts, existence checks, and sorted key listing', async () => {
    const storage = new SqliteStorage(':memory:', createSilentLogger());

    expect((await storage.save('entities', 'b', { value: 1 })).ok).toBe(true);
    expect((await storage.save('entities', 'a', { value: 2 })).ok).toBe(true);
    expect((await storage.save('other', 'a', { value: 3 })).ok).toBe(true);
    const listed = await storage.list('entities');
    if (isErr(listed)) throw listed.error;
    expect(listed.value).toEqual(['a', 'b']);
    const exists = await storage.exists('entities', 'a');
    if (isErr(exists)) throw exists.error;
    expect(exists.value).toBe(true);

    await storage.save('entities', 'a', { value: 4 });
    const loaded = await storage.load<{ value: number }>('entities', 'a');
    if (isErr(loaded)) throw loaded.error;
    expect(loaded.value).toEqual({ value: 4 });

    await storage.delete('entities', 'a');
    const deleted = await storage.exists('entities', 'a');
    if (isErr(deleted)) throw deleted.error;
    expect(deleted.value).toBe(false);
    expect(isErr(await storage.load('entities', 'missing'))).toBe(true);
    await storage.close();
    expect(isErr(await storage.exists('entities', 'b'))).toBe(true);
  });

  it('persists JSON data across database connections', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'project-dna-storage-'));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, 'dna.sqlite');
    const first = new SqliteStorage(databasePath, createSilentLogger());
    await first.save('snapshots', 'v0001', { version: 1, metrics: [1, 2, 3] });
    await first.close();

    const second = new SqliteStorage(databasePath, createSilentLogger());
    const restored = await second.load('snapshots', 'v0001');
    if (isErr(restored)) throw restored.error;
    expect(restored.value).toEqual({
      version: 1,
      metrics: [1, 2, 3],
    });
    await second.close();
  });

  it('commits preconditioned saves and deletes as one atomic batch', async () => {
    const storage = new SqliteStorage(':memory:', createSilentLogger());
    await storage.save('latest', 'repository', { version: 1 });
    await storage.save('obsolete', 'repository:v1', { value: true });

    const committed = await storage.applyAtomically({
      preconditions: [
        { type: 'equals', namespace: 'latest', key: 'repository', data: { version: 1 } },
        { type: 'missing', namespace: 'aggregate', key: 'repository:v2' },
      ],
      mutations: [
        {
          type: 'save',
          namespace: 'aggregate',
          key: 'repository:v2',
          data: { version: 2 },
        },
        { type: 'save', namespace: 'latest', key: 'repository', data: { version: 2 } },
        { type: 'delete', namespace: 'obsolete', key: 'repository:v1' },
      ],
    });

    expect(committed.ok).toBe(true);
    const aggregate = await storage.load<{ version: number }>('aggregate', 'repository:v2');
    const latest = await storage.load<{ version: number }>('latest', 'repository');
    const obsolete = await storage.exists('obsolete', 'repository:v1');
    if (isErr(aggregate)) throw aggregate.error;
    if (isErr(latest)) throw latest.error;
    if (isErr(obsolete)) throw obsolete.error;
    expect(aggregate.value.version).toBe(2);
    expect(latest.value.version).toBe(2);
    expect(obsolete.value).toBe(false);
    await storage.close();
  });

  it('rejects stale preconditions without applying any mutation', async () => {
    const storage = new SqliteStorage(':memory:', createSilentLogger());
    await storage.save('latest', 'repository', { version: 2 });

    const rejected = await storage.applyAtomically({
      preconditions: [
        { type: 'equals', namespace: 'latest', key: 'repository', data: { version: 1 } },
      ],
      mutations: [
        {
          type: 'save',
          namespace: 'aggregate',
          key: 'repository:v3',
          data: { version: 3 },
        },
      ],
    });

    expect(isErr(rejected)).toBe(true);
    if (!isErr(rejected)) throw new Error('Expected the atomic batch to fail');
    expect(rejected.error).toBeInstanceOf(StorageConflictError);
    const aggregate = await storage.exists('aggregate', 'repository:v3');
    const latest = await storage.load<{ version: number }>('latest', 'repository');
    if (isErr(aggregate)) throw aggregate.error;
    if (isErr(latest)) throw latest.error;
    expect(aggregate.value).toBe(false);
    expect(latest.value.version).toBe(2);
    await storage.close();
  });

  it('preserves raw forensic evidence and supports raw compare-and-set', async () => {
    const databasePath = await createDatabasePath();
    const setup = new Database(databasePath);
    migrate(setup);
    setup
      .prepare(
        'INSERT INTO dna_store (namespace, key, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run('latest', 'repository', '{invalid-json', 11, 22);
    setup.close();

    const storage = new SqliteStorage(databasePath, createSilentLogger());
    const evidence = await storage.inspect('latest', 'repository');
    if (isErr(evidence)) throw evidence.error;
    expect(evidence.value).toEqual({
      value: '{invalid-json',
      createdAt: 11,
      updatedAt: 22,
    });
    const repaired = await storage.applyAtomically({
      preconditions: [
        {
          type: 'raw-equals',
          namespace: 'latest',
          key: 'repository',
          value: '{invalid-json',
        },
      ],
      mutations: [{ type: 'save', namespace: 'latest', key: 'repository', data: { version: 1 } }],
    });
    expect(repaired.ok).toBe(true);
    const latest = await storage.load<{ version: number }>('latest', 'repository');
    if (isErr(latest)) throw latest.error;
    expect(latest.value.version).toBe(1);
    await storage.close();
  });

  it('rolls back earlier mutations when SQLite rejects a later mutation', async () => {
    const databasePath = await createDatabasePath();
    const setup = new Database(databasePath);
    migrate(setup);
    setup.exec(`
      CREATE TRIGGER reject_failed_namespace
      BEFORE INSERT ON dna_store
      WHEN NEW.namespace = 'fail'
      BEGIN
        SELECT RAISE(ABORT, 'injected write failure');
      END;
    `);
    setup.close();

    const storage = new SqliteStorage(databasePath, createSilentLogger());
    const rejected = await storage.applyAtomically({
      mutations: [
        { type: 'save', namespace: 'aggregate', key: 'repository:v1', data: { version: 1 } },
        { type: 'save', namespace: 'fail', key: 'repository:v1', data: { version: 1 } },
      ],
    });

    expect(isErr(rejected)).toBe(true);
    const aggregate = await storage.exists('aggregate', 'repository:v1');
    if (isErr(aggregate)) throw aggregate.error;
    expect(aggregate.value).toBe(false);
    await storage.close();
  });

  it('serializes every value before starting an atomic transaction', async () => {
    const storage = new SqliteStorage(':memory:', createSilentLogger());
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;

    const rejected = await storage.applyAtomically({
      mutations: [
        { type: 'save', namespace: 'aggregate', key: 'repository:v1', data: { version: 1 } },
        { type: 'save', namespace: 'aggregate', key: 'repository:v2', data: circular },
      ],
    });

    expect(isErr(rejected)).toBe(true);
    const first = await storage.exists('aggregate', 'repository:v1');
    if (isErr(first)) throw first.error;
    expect(first.value).toBe(false);
    await storage.close();
  });

  it('migrates a legacy schema-zero database without changing stored data', async () => {
    const databasePath = await createDatabasePath();
    const legacy = new Database(databasePath);
    legacy.exec(`
      CREATE TABLE dna_store (
        namespace TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (namespace, key)
      );
    `);
    legacy
      .prepare(
        'INSERT INTO dna_store (namespace, key, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run('snapshots', 'repository:v1', JSON.stringify({ version: 1 }), 1, 1);
    legacy.close();

    const storage = new SqliteStorage(databasePath, createSilentLogger());
    const restored = await storage.load<{ version: number }>('snapshots', 'repository:v1');
    if (isErr(restored)) throw restored.error;
    expect(restored.value.version).toBe(1);
    await storage.close();

    const migrated = new Database(databasePath, { readonly: true });
    expect(migrated.pragma('user_version', { simple: true })).toBe(CURRENT_SCHEMA_VERSION);
    migrated.close();
  });

  it('fails startup validation when SQLite quick_check reports corruption', () => {
    const database = {
      pragma: () => [{ quick_check: 'database disk image is malformed' }],
    } as unknown as Database.Database;

    expect(() => validateDatabaseForMigration(database)).toThrow(
      /SQLite quick_check failed: database disk image is malformed/u,
    );
  });

  it('rejects an incompatible existing schema without advancing the schema version', async () => {
    const databasePath = await createDatabasePath();
    const incompatible = new Database(databasePath);
    incompatible.exec('CREATE TABLE dna_store (value TEXT NOT NULL);');
    incompatible.close();

    expect(() => new SqliteStorage(databasePath, createSilentLogger())).toThrow();
    const unchanged = new Database(databasePath, { readonly: true });
    expect(unchanged.pragma('user_version', { simple: true })).toBe(0);
    expect(
      unchanged
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
        .get('idx_dna_store_namespace'),
    ).toBeUndefined();
    unchanged.close();
  });

  it('rejects databases created by a newer schema without modifying them', async () => {
    const databasePath = await createDatabasePath();
    const future = new Database(databasePath);
    future.pragma(`user_version = ${CURRENT_SCHEMA_VERSION + 1}`);
    const journalMode = future.pragma('journal_mode', { simple: true });
    future.close();

    expect(() => new SqliteStorage(databasePath, createSilentLogger())).toThrow(
      /newer than supported/u,
    );
    const unchanged = new Database(databasePath, { readonly: true });
    expect(unchanged.pragma('user_version', { simple: true })).toBe(CURRENT_SCHEMA_VERSION + 1);
    expect(unchanged.pragma('journal_mode', { simple: true })).toBe(journalMode);
    unchanged.close();
  });
});

async function createDatabasePath(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'project-dna-storage-'));
  temporaryDirectories.push(directory);
  return path.join(directory, 'dna.sqlite');
}
