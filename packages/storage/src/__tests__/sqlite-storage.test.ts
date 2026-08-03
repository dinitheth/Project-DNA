import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSilentLogger, isErr } from '@project-dna/shared';
import { SqliteStorage } from '../sqlite-storage.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
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
});
