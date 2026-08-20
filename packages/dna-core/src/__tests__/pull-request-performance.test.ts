import { performance } from 'node:perf_hooks';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { GitCommitMetadataProvider, HistoricalTreeMaterializer } from '../index.js';

const run = promisify(execFile);
const provider = new GitCommitMetadataProvider();
const materializer = new HistoricalTreeMaterializer();

describe('pull request impact performance corpus', () => {
  it('measures equivalent final trees across 1, 10, and 100 commit histories', async () => {
    const measurements: Array<{
      commits: number;
      metadataMs: number;
      materializationMs: number;
      rssMiB: number;
    }> = [];
    for (const commits of [1, 10, 100]) {
      const root = await repository();
      try {
        await writeFile(path.join(root, 'stable.ts'), 'export const stable = true;\n');
        await git(root, ['add', '.']);
        const baseSha = await commit(root, 'base');
        for (let index = 0; index < commits; index++)
          await git(root, ['commit', '--allow-empty', '-qm', `history-${index}`]);
        const headSha = await output(root, ['rev-parse', 'HEAD']);
        const beforeRss = process.memoryUsage().rss;
        const metadataStart = performance.now();
        const metadata = await provider.getPullRequestTreeRange(root, { baseSha, headSha });
        const metadataMs = performance.now() - metadataStart;
        expect(metadata.ok).toBe(true);
        if (!metadata.ok) continue;
        const materializationStart = performance.now();
        const tree = await materializer.materialize(root, metadata.value.headTreeSha);
        const materializationMs = performance.now() - materializationStart;
        expect(tree.ok).toBe(true);
        if (tree.ok) await tree.value.cleanup();
        measurements.push({
          commits,
          metadataMs: Number(metadataMs.toFixed(2)),
          materializationMs: Number(materializationMs.toFixed(2)),
          rssMiB: Number(((process.memoryUsage().rss - beforeRss) / 1024 / 1024).toFixed(2)),
        });
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
    console.info('M7 PR performance equivalent-history measurements', measurements);
    expect(measurements).toHaveLength(3);
    expect(
      measurements.every((item) => item.metadataMs < 30_000 && item.materializationMs < 30_000),
    ).toBe(true);
  }, 120_000);

  it('measures a bounded large changed-file set', async () => {
    const root = await repository();
    try {
      await writeFile(path.join(root, 'base.ts'), 'base\n');
      await git(root, ['add', '.']);
      const baseSha = await commit(root, 'base');
      for (let index = 0; index < 200; index++)
        await writeFile(
          path.join(root, `changed-${String(index).padStart(3, '0')}.ts`),
          `export const value${index} = ${index};\n`,
        );
      await git(root, ['add', '.']);
      const headSha = await commit(root, 'large change');
      const start = performance.now();
      const result = await provider.getPullRequestTreeRange(
        root,
        { baseSha, headSha },
        { maxChangedFiles: 100 },
      );
      const elapsed = Number((performance.now() - start).toFixed(2));
      console.info('M7 PR performance large-change measurement', {
        elapsedMs: elapsed,
        changedFiles: result.ok ? result.value.changedFiles.length : null,
        complete: result.ok ? result.value.complete : false,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.changedFiles).toHaveLength(100);
        expect(result.value.complete).toBe(false);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 60_000);
});

async function repository(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'project-dna-pr-perf-'));
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
