import { execFile } from 'node:child_process';
import { lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { HistoricalTreeError, HistoricalTreeMaterializer } from '../index.js';

const run = promisify(execFile);
const materializer = new HistoricalTreeMaterializer();

describe('HistoricalTreeMaterializer', () => {
  it('materializes an immutable tree and cleans up its private root', async () => {
    const repository = await createRepository();
    try {
      await writeFile(path.join(repository, 'src.ts'), 'export const value = 1;\n');
      await git(repository, ['add', '.']);
      await git(repository, ['commit', '-qm', 'fixture']);
      const tree = await gitOutput(repository, ['rev-parse', 'HEAD^{tree}']);
      const result = await materializer.materialize(repository, tree);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(await readFile(path.join(result.value.rootPath, 'src.ts'), 'utf8')).toContain('value');
      expect(result.value.fileCount).toBe(1);
      expect(result.value.extractedBytes).toBeGreaterThan(0);
      const rootPath = result.value.rootPath;
      await result.value.cleanup();
      await expect(lstat(rootPath)).rejects.toThrow();
    } finally {
      await rm(repository, { recursive: true, force: true });
    }
  }, 30_000);

  it('enforces archive and extracted bounds and cleans failed roots', async () => {
    const repository = await createRepository();
    try {
      await writeFile(path.join(repository, 'large.ts'), 'x'.repeat(128));
      await git(repository, ['add', '.']);
      await git(repository, ['commit', '-qm', 'fixture']);
      const tree = await gitOutput(repository, ['rev-parse', 'HEAD^{tree}']);
      const archiveLimited = await materializer.materialize(repository, tree, {
        maxArchiveBytes: 1,
      });
      expect(archiveLimited.ok).toBe(false);
      if (!archiveLimited.ok)
        expect((archiveLimited.error as HistoricalTreeError).code).toBe('archive-limit');
      const fileLimited = await materializer.materialize(repository, tree, { maxFileBytes: 10 });
      expect(fileLimited.ok).toBe(false);
      if (!fileLimited.ok)
        expect((fileLimited.error as HistoricalTreeError).code).toBe('extracted-limit');
    } finally {
      await rm(repository, { recursive: true, force: true });
    }
  }, 30_000);

  it('cancels before materialization without creating a result', async () => {
    const repository = await createRepository();
    try {
      await writeFile(path.join(repository, 'src.ts'), 'source\n');
      await git(repository, ['add', '.']);
      await git(repository, ['commit', '-qm', 'fixture']);
      const tree = await gitOutput(repository, ['rev-parse', 'HEAD^{tree}']);
      const controller = new AbortController();
      controller.abort();
      const result = await materializer.materialize(repository, tree, {}, controller.signal);
      expect(result.ok).toBe(false);
      if (!result.ok) expect((result.error as HistoricalTreeError).code).toBe('cancelled');
    } finally {
      await rm(repository, { recursive: true, force: true });
    }
  }, 30_000);

  it('materializes the canonical empty tree for root-commit before state', async () => {
    const repository = await createRepository();
    try {
      const result = await materializer.materialize(
        repository,
        '4b825dc642cb6eb9a060e54bf8d69288fbee4904',
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.fileCount).toBe(0);
      expect(result.value.extractedBytes).toBe(0);
      await result.value.cleanup();
    } finally {
      await rm(repository, { recursive: true, force: true });
    }
  }, 30_000);
});

async function createRepository(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'project-dna-materialize-'));
  await git(root, ['init', '-q']);
  await git(root, ['config', 'user.email', 'project-dna@example.invalid']);
  await git(root, ['config', 'user.name', 'Project DNA']);
  return root;
}

async function git(root: string, args: readonly string[]): Promise<void> {
  await run('git', args, { cwd: root, windowsHide: true });
}

async function gitOutput(root: string, args: readonly string[]): Promise<string> {
  const result = await run('git', args, { cwd: root, windowsHide: true });
  return result.stdout.trim();
}
