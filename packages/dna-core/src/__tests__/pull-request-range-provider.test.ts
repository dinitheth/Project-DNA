import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { GitCommitMetadataProvider, PullRequestGitError } from '../index.js';

const run = promisify(execFile);
const provider = new GitCommitMetadataProvider();

describe('pull request tree range provider', () => {
  it('collapses repeated edits into one final base-to-head change', async () => {
    const root = await repository();
    try {
      await writeFile(path.join(root, 'value.ts'), 'export const value = 1;\n');
      await git(root, ['add', '.']);
      const baseSha = await commit(root, 'base');
      await writeFile(path.join(root, 'value.ts'), 'export const value = 2;\n');
      await git(root, ['add', '.']);
      await commit(root, 'middle');
      await writeFile(path.join(root, 'value.ts'), 'export const value = 3;\n');
      await git(root, ['add', '.']);
      const headSha = await commit(root, 'head');
      const result = await provider.getPullRequestTreeRange(root, { baseSha, headSha });
      expect(result.ok, result.ok ? '' : result.error.message).toBe(true);
      if (!result.ok) return;
      expect(result.value.mergeBaseSha).toBe(baseSha);
      expect(result.value.changedFiles).toEqual([
        expect.objectContaining({ kind: 'modified', path: 'value.ts' }),
      ]);
      expect(result.value.renameDetectionPolicy).toBe('find-renames=50%');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('reports final rename-chain metadata deterministically', async () => {
    const root = await repository();
    try {
      await writeFile(path.join(root, 'a.ts'), 'export const stable = true;\n');
      await git(root, ['add', '.']);
      const baseSha = await commit(root, 'base');
      await git(root, ['mv', 'a.ts', 'b.ts']);
      await git(root, ['commit', '-qm', 'rename one']);
      await git(root, ['mv', 'b.ts', 'c.ts']);
      await git(root, ['commit', '-qm', 'rename two']);
      const headSha = await output(root, ['rev-parse', 'HEAD']);
      const first = await provider.getPullRequestTreeRange(root, { baseSha, headSha });
      const second = await provider.getPullRequestTreeRange(root, { baseSha, headSha });
      expect(first).toEqual(second);
      if (first.ok)
        expect(first.value.changedFiles).toEqual([
          expect.objectContaining({ kind: 'renamed', previousPath: 'a.ts', path: 'c.ts' }),
        ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('uses explicit base/head trees even when the head is a merge commit', async () => {
    const root = await repository();
    try {
      await writeFile(path.join(root, 'base.ts'), 'base\n');
      await git(root, ['add', '.']);
      const baseSha = await commit(root, 'base');
      await git(root, ['checkout', '-qb', 'feature']);
      await writeFile(path.join(root, 'feature.ts'), 'feature\n');
      await git(root, ['add', '.']);
      const feature = await commit(root, 'feature');
      await git(root, ['checkout', '-q', 'master']);
      await writeFile(path.join(root, 'main.ts'), 'main\n');
      await git(root, ['add', '.']);
      await commit(root, 'main');
      await git(root, ['merge', '--no-ff', '-q', feature, '-m', 'merge']);
      const headSha = await output(root, ['rev-parse', 'HEAD']);
      const result = await provider.getPullRequestTreeRange(root, { baseSha, headSha });
      expect(result.ok).toBe(true);
      if (result.ok)
        expect(result.value.changedFiles.map((file) => file.path)).toEqual([
          'feature.ts',
          'main.ts',
        ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('fails explicitly for unrelated history, missing identities, bounds, and cancellation', async () => {
    const root = await repository();
    try {
      await writeFile(path.join(root, 'a.ts'), 'a\n');
      await git(root, ['add', '.']);
      const baseSha = await commit(root, 'base');
      await git(root, ['checkout', '--orphan', 'unrelated']);
      await git(root, ['rm', '-rf', '.']);
      await writeFile(path.join(root, 'b.ts'), 'b\n');
      await git(root, ['add', '.']);
      const headSha = await commit(root, 'unrelated');
      const unrelated = await provider.getPullRequestTreeRange(root, { baseSha, headSha });
      expect(unrelated.ok).toBe(false);
      if (!unrelated.ok)
        expect((unrelated.error as PullRequestGitError).code).toBe('missing-merge-base');
      const missing = await provider.getPullRequestTreeRange(root, {
        baseSha: 'f'.repeat(40),
        headSha,
      });
      expect(missing.ok).toBe(false);
      if (!missing.ok) expect((missing.error as PullRequestGitError).code).toBe('missing-base');
      const missingHead = await provider.getPullRequestTreeRange(root, {
        baseSha,
        headSha: 'e'.repeat(40),
      });
      expect(missingHead.ok).toBe(false);
      if (!missingHead.ok)
        expect((missingHead.error as PullRequestGitError).code).toBe('missing-head');
      const invalidBound = await provider.getPullRequestTreeRange(
        root,
        { baseSha, headSha },
        { maxChangedFiles: 10_001 },
      );
      expect(invalidBound.ok).toBe(false);
      const controller = new AbortController();
      controller.abort();
      const cancelled = await provider.getPullRequestTreeRange(
        root,
        { baseSha, headSha },
        {},
        controller.signal,
      );
      expect(cancelled.ok).toBe(false);
      if (!cancelled.ok) expect((cancelled.error as PullRequestGitError).code).toBe('cancelled');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('reports an explicit ambiguous merge base for criss-cross history', async () => {
    const root = await repository();
    try {
      await writeFile(path.join(root, 'base.ts'), 'base\n');
      await git(root, ['add', '.']);
      const ancestor = await commit(root, 'ancestor');
      const tree = await output(root, ['rev-parse', `${ancestor}^{tree}`]);
      const left = await output(root, ['commit-tree', tree, '-p', ancestor, '-m', 'left']);
      const right = await output(root, ['commit-tree', tree, '-p', ancestor, '-m', 'right']);
      const leftMerge = await output(root, [
        'commit-tree',
        tree,
        '-p',
        left,
        '-p',
        right,
        '-m',
        'left merge',
      ]);
      const rightMerge = await output(root, [
        'commit-tree',
        tree,
        '-p',
        right,
        '-p',
        left,
        '-m',
        'right merge',
      ]);
      const result = await provider.getPullRequestTreeRange(root, {
        baseSha: leftMerge,
        headSha: rightMerge,
      });
      expect(result.ok).toBe(false);
      if (!result.ok)
        expect((result.error as PullRequestGitError).code).toBe('ambiguous-merge-base');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('reports missing history in a shallow clone without fetching remotely', async () => {
    const origin = await repository();
    const clone = await mkdtemp(path.join(os.tmpdir(), 'project-dna-pr-shallow-'));
    try {
      await writeFile(path.join(origin, 'value.ts'), 'one\n');
      await git(origin, ['add', '.']);
      const baseSha = await commit(origin, 'base');
      await writeFile(path.join(origin, 'value.ts'), 'two\n');
      await git(origin, ['add', '.']);
      const headSha = await commit(origin, 'head');
      await run(
        'git',
        ['clone', '-q', '--depth', '1', `file:///${origin.replaceAll('\\', '/')}`, clone],
        {
          windowsHide: true,
        },
      );
      const result = await provider.getPullRequestTreeRange(clone, { baseSha, headSha });
      expect(result.ok).toBe(false);
      if (!result.ok) expect((result.error as PullRequestGitError).code).toBe('missing-base');
    } finally {
      await rm(origin, { recursive: true, force: true });
      await rm(clone, { recursive: true, force: true });
    }
  }, 30_000);
});

async function repository(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'project-dna-pr-'));
  await git(root, ['init', '-q']);
  await git(root, ['config', 'user.email', 'project-dna@example.invalid']);
  await git(root, ['config', 'user.name', 'Project DNA']);
  return root;
}
async function commit(root: string, message: string): Promise<string> {
  await git(root, ['commit', '-qm', message]);
  return output(root, ['rev-parse', 'HEAD']);
}
async function git(root: string, args: readonly string[]): Promise<void> {
  await run('git', args, { cwd: root, windowsHide: true });
}
async function output(root: string, args: readonly string[]): Promise<string> {
  return (await run('git', args, { cwd: root, windowsHide: true })).stdout.trim();
}
