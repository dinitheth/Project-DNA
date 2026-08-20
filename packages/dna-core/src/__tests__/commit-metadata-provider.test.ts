import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { CommitGitError, GitCommitMetadataProvider } from '../index.js';

const run = promisify(execFile);
const provider = new GitCommitMetadataProvider();

describe('GitCommitMetadataProvider', () => {
  it('reports root and normal commits from immutable Git trees', async () => {
    const root = await createRepository();
    try {
      await writeFile(path.join(root, 'a.ts'), 'export const a = 1;\n');
      await git(root, ['add', '.']);
      const rootCommit = await commit(root, 'root');
      await writeFile(path.join(root, 'b.ts'), 'export const b = 2;\n');
      await git(root, ['add', '.']);
      const secondCommit = await commit(root, 'second');

      const rootResult = await provider.getCommitMetadata(root, { commitSha: rootCommit });
      expect(rootResult.ok).toBe(true);
      if (!rootResult.ok) return;
      expect(rootResult.value.parentCommits).toEqual([]);
      expect(rootResult.value.parentCommitSha).toBeNull();
      expect(rootResult.value.changedFiles).toEqual([
        expect.objectContaining({ kind: 'added', path: 'a.ts', oldBlobSha: null }),
      ]);

      const result = await provider.getCommitMetadata(root, { commitSha: secondCommit });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.parentCommitSha).toBe(rootCommit);
      expect(result.value.changedFiles).toEqual([
        expect.objectContaining({ kind: 'added', path: 'b.ts', oldBlobSha: null }),
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('detects modified, deleted, renamed, type-changed, binary, and symlink paths', async () => {
    const root = await createRepository();
    try {
      await writeFile(
        path.join(root, 'old.ts'),
        'export const value = 1;\nexport const stable = true;\n',
      );
      await writeFile(path.join(root, 'deleted.ts'), 'removed\n');
      await writeFile(path.join(root, 'binary.bin'), Buffer.from([0, 1, 2]));
      await git(root, ['add', '.']);
      await commit(root, 'base');
      await git(root, ['mv', 'old.ts', 'renamed.ts']);
      await writeFile(
        path.join(root, 'renamed.ts'),
        'export const value = 2;\nexport const stable = true;\n',
      );
      await writeFile(path.join(root, 'binary.bin'), Buffer.from([0, 1, 3]));
      await writeFile(path.join(root, 'deleted.ts'), 'changed\n');
      await git(root, ['rm', '-f', 'deleted.ts']);
      await writeFile(path.join(root, 'type.txt'), 'plain\n');
      await git(root, ['add', 'type.txt']);
      await git(root, ['update-index', '--chmod=+x', 'type.txt']);
      const symlinkPath = path.join(root, 'link.ts');
      try {
        await run('cmd', ['/c', 'mklink', symlinkPath, path.join(root, 'renamed.ts')], {
          windowsHide: true,
        });
      } catch {
        // Symlink creation may be unavailable on restricted Windows runners.
      }
      await git(root, ['add', '-A']);
      const sha = await commit(root, 'changes');
      const result = await provider.getCommitMetadata(root, { commitSha: sha });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.changedFiles.map((file) => [file.kind, file.path])).toEqual(
        expect.arrayContaining([
          ['renamed', 'renamed.ts'],
          ['deleted', 'deleted.ts'],
          ['modified', 'binary.bin'],
        ]),
      );
      expect(result.value.changedFiles.find((file) => file.path === 'binary.bin')).toMatchObject({
        binary: true,
        contentKind: 'binary',
      });
      if (result.value.changedFiles.some((file) => file.path === 'link.ts'))
        expect(result.value.changedFiles.find((file) => file.path === 'link.ts')).toMatchObject({
          contentKind: 'symlink',
        });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('requires an explicit parent for merges and validates direct parents', async () => {
    const root = await createRepository();
    try {
      await writeFile(path.join(root, 'base.ts'), 'base\n');
      await git(root, ['add', '.']);
      await commit(root, 'base');
      await git(root, ['checkout', '-q', '-b', 'feature']);
      await writeFile(path.join(root, 'feature.ts'), 'feature\n');
      await git(root, ['add', '.']);
      const feature = await commit(root, 'feature');
      await git(root, ['checkout', '-q', 'master']);
      await writeFile(path.join(root, 'main.ts'), 'main\n');
      await git(root, ['add', '.']);
      const main = await commit(root, 'main');
      await git(root, ['merge', '--no-ff', '-q', feature, '-m', 'merge']);
      const mergeSha = await gitOutput(root, ['rev-parse', 'HEAD']);

      const ambiguous = await provider.getCommitMetadata(root, { commitSha: mergeSha });
      expect(ambiguous.ok).toBe(false);
      if (!ambiguous.ok)
        expect((ambiguous.error as CommitGitError).code).toBe('ambiguous-merge-parent');
      const parents = await provider.getCommitParents(root, mergeSha);
      expect(parents).toEqual({ ok: true, value: [main, feature] });
      const selected = await provider.getCommitMetadata(root, {
        commitSha: mergeSha,
        parentSha: main,
      });
      expect(selected.ok, selected.ok ? '' : selected.error.message).toBe(true);
      if (selected.ok) expect(selected.value.parentCommitSha).toBe(main);
      const invalid = await provider.getCommitMetadata(root, {
        commitSha: mergeSha,
        parentSha: 'f'.repeat(40),
      });
      expect(invalid.ok).toBe(false);
      if (!invalid.ok) expect((invalid.error as CommitGitError).code).toBe('invalid-parent');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('rejects abbreviated SHAs and cancellation', async () => {
    const root = await createRepository();
    try {
      await writeFile(path.join(root, 'a.ts'), 'a\n');
      await git(root, ['add', '.']);
      const sha = await commit(root, 'base');
      const abbreviated = await provider.getCommitMetadata(root, { commitSha: sha.slice(0, 8) });
      expect(abbreviated.ok).toBe(false);
      const controller = new AbortController();
      controller.abort();
      const cancelled = await provider.getCommitMetadata(
        root,
        { commitSha: sha },
        {},
        controller.signal,
      );
      expect(cancelled.ok).toBe(false);
      if (!cancelled.ok) expect((cancelled.error as CommitGitError).code).toBe('cancelled');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});

async function createRepository(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'project-dna-commit-'));
  await git(root, ['init', '-q']);
  await git(root, ['config', 'user.email', 'project-dna@example.invalid']);
  await git(root, ['config', 'user.name', 'Project DNA']);
  return root;
}

async function commit(root: string, message: string): Promise<string> {
  await git(root, ['commit', '-qm', message]);
  return gitOutput(root, ['rev-parse', 'HEAD']);
}

async function git(root: string, args: readonly string[]): Promise<void> {
  await run('git', args, { cwd: root, windowsHide: true });
}

async function gitOutput(root: string, args: readonly string[]): Promise<string> {
  const result = await run('git', args, { cwd: root, windowsHide: true });
  return result.stdout.trim();
}
