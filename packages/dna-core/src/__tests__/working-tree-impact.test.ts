import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { GitChangeSetProvider, WorkingTreeGitError } from '../service/git-change-set-provider.js';

const run = promisify(execFile);

describe('GitChangeSetProvider', () => {
  it('reports clean, modified, added, deleted, and ignored paths deterministically', async () => {
    const root = await createRepository();
    try {
      await writeFile(path.join(root, 'tracked.ts'), 'export const value = 2;\n');
      await writeFile(path.join(root, 'deleted.ts'), 'export const removed = true;\n');
      await writeFile(path.join(root, '.gitignore'), 'ignored.ts\n');
      await runGit(root, ['add', '.']);
      await runGit(root, ['commit', '-m', 'fixture']);
      await writeFile(path.join(root, 'tracked.ts'), 'export const value = 3;\n');
      await writeFile(path.join(root, 'added.ts'), 'export const added = true;\n');
      await runGit(root, ['rm', 'deleted.ts']);
      await writeFile(path.join(root, 'ignored.ts'), 'ignored\n');

      const result = await new GitChangeSetProvider().getWorkingTreeChangeSet(root);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.changes.map((change) => [change.kind, change.path])).toEqual([
        ['added', 'added.ts'],
        ['deleted', 'deleted.ts'],
        ['modified', 'tracked.ts'],
      ]);
      expect(result.value.changes.every((change) => !change.path.includes('ignored'))).toBe(true);
      expect(result.value.complete).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('detects a Git rename and changes content fingerprints when bytes change', async () => {
    const root = await createRepository();
    try {
      await writeFile(path.join(root, 'old.ts'), 'export const value = 1;\n');
      await runGit(root, ['add', '.']);
      await runGit(root, ['commit', '-m', 'fixture']);
      await runGit(root, ['mv', 'old.ts', 'new.ts']);
      const provider = new GitChangeSetProvider();
      const first = await provider.getWorkingTreeChangeSet(root);
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      expect(first.value.changes[0]).toMatchObject({
        kind: 'renamed',
        path: 'new.ts',
        previousPath: 'old.ts',
      });
      await writeFile(path.join(root, 'new.ts'), 'export const value = 2;\n');
      const second = await provider.getWorkingTreeChangeSet(root);
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(second.value.contentFingerprint).not.toBe(first.value.contentFingerprint);
      expect(second.value.changeSetFingerprint).not.toBe(first.value.changeSetFingerprint);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('preserves staged and unstaged state for the same tracked path', async () => {
    const root = await createRepository();
    try {
      await writeFile(path.join(root, 'tracked.ts'), 'export const value = 1;\n');
      await runGit(root, ['add', '.']);
      await runGit(root, ['commit', '-m', 'fixture']);
      await writeFile(path.join(root, 'tracked.ts'), 'export const value = 2;\n');
      await runGit(root, ['add', 'tracked.ts']);
      await writeFile(path.join(root, 'tracked.ts'), 'export const value = 3;\n');
      const result = await new GitChangeSetProvider().getWorkingTreeChangeSet(root);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.changes).toEqual([
        expect.objectContaining({ path: 'tracked.ts', staged: true, unstaged: true }),
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('rejects non-repositories and cancellation explicitly', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'project-dna-not-git-'));
    try {
      const result = await new GitChangeSetProvider().getWorkingTreeChangeSet(root);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBeInstanceOf(WorkingTreeGitError);
      const controller = new AbortController();
      controller.abort();
      const cancelled = await new GitChangeSetProvider().getWorkingTreeChangeSet(
        root,
        undefined,
        controller.signal,
      );
      expect(cancelled.ok).toBe(false);
      if (!cancelled.ok) expect((cancelled.error as WorkingTreeGitError).code).toBe('cancelled');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('rejects repositories without a commit', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'project-dna-no-commit-'));
    try {
      await runGit(root, ['init', '-q']);
      const result = await new GitChangeSetProvider().getWorkingTreeChangeSet(root);
      expect(result.ok).toBe(false);
      if (!result.ok) expect((result.error as WorkingTreeGitError).code).toBe('no-commit');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});

async function createRepository(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'project-dna-git-'));
  await mkdir(path.join(root, 'src'), { recursive: true });
  await runGit(root, ['init', '-q']);
  await runGit(root, ['config', 'user.email', 'project-dna@example.invalid']);
  await runGit(root, ['config', 'user.name', 'Project DNA']);
  return root;
}

async function runGit(cwd: string, args: readonly string[]): Promise<void> {
  await run('git', args, { cwd, windowsHide: true });
}
