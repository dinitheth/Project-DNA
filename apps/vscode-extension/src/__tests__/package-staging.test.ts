import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const requireScript = createRequire(path.resolve(__dirname, 'package-staging.test.cjs'));
const { SQLITE_FILES, normalizeRelative, normalizeStagingTree } = requireScript(
  '../../scripts/stage-extension.mjs',
) as {
  readonly SQLITE_FILES: readonly string[];
  readonly normalizeRelative: (value: string) => string;
  readonly normalizeStagingTree: (root: string, epochSeconds?: number) => void;
};
const { createIntegrityManifest } = requireScript(
  '../../scripts/create-integrity-manifest.mjs',
) as {
  readonly createIntegrityManifest: (options: {
    readonly stagingRoot: string;
    readonly outputPath: string;
    readonly metadata: Record<string, string>;
  }) => unknown;
};
const { validateStaging } = requireScript('../../scripts/validate-package.mjs') as {
  readonly validateStaging: (options: {
    readonly stagingRoot: string;
    readonly contract: unknown;
    readonly target: string;
    readonly runtime: string;
  }) => unknown;
};

describe('deterministic package staging contract', () => {
  it('normalizes paths deterministically', () => {
    expect(normalizeRelative('node_modules\\better-sqlite3\\lib\\index.js')).toBe(
      'node_modules/better-sqlite3/lib/index.js',
    );
  });

  it('contains the complete explicit-binding SQLite runtime allowlist', () => {
    expect(SQLITE_FILES).toEqual([
      'package.json',
      'lib/index.js',
      'lib/database.js',
      'lib/sqlite-error.js',
      'lib/util.js',
      'lib/methods/aggregate.js',
      'lib/methods/backup.js',
      'lib/methods/function.js',
      'lib/methods/inspect.js',
      'lib/methods/pragma.js',
      'lib/methods/serialize.js',
      'lib/methods/table.js',
      'lib/methods/transaction.js',
      'lib/methods/wrappers.js',
    ]);
  });

  it('does not include default binding discovery dependencies', () => {
    expect(JSON.stringify(SQLITE_FILES)).not.toContain('bindings');
    expect(JSON.stringify(SQLITE_FILES)).not.toContain('prebuild-install');
    expect(JSON.stringify(SQLITE_FILES)).not.toContain('file-uri-to-path');
  });

  it('normalizes identical staging inputs to identical integrity manifests', async () => {
    const first = await mkdtemp(path.join(tmpdir(), 'project-dna-stage-a-'));
    const second = await mkdtemp(path.join(tmpdir(), 'project-dna-stage-b-'));
    try {
      for (const root of [first, second]) {
        await mkdir(path.join(root, 'dist'), { recursive: true });
        await writeFile(path.join(root, 'dist', 'extension.js'), 'stable bytes\n');
      }
      const firstManifestPath = path.join(first, '..', `${path.basename(first)}.json`);
      const secondManifestPath = path.join(second, '..', `${path.basename(second)}.json`);
      normalizeStagingTree(first, 0);
      normalizeStagingTree(second, 0);
      const firstManifest = createIntegrityManifest({
        stagingRoot: first,
        outputPath: firstManifestPath,
        metadata: { target: 'linux-x64', abi: '137' },
      });
      const secondManifest = createIntegrityManifest({
        stagingRoot: second,
        outputPath: secondManifestPath,
        metadata: { target: 'linux-x64', abi: '137' },
      });
      expect(firstManifest).toEqual(secondManifest);
      expect(await readFile(firstManifestPath, 'utf8')).toBe(
        await readFile(secondManifestPath, 'utf8'),
      );
    } finally {
      await rm(first, { recursive: true, force: true });
      await rm(second, { recursive: true, force: true });
      await rm(firstManifestPathFor(first), { force: true });
      await rm(firstManifestPathFor(second), { force: true });
    }
  });

  it('rejects missing and unexpected staged files', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'project-dna-validate-'));
    try {
      await writeFile(path.join(root, 'package.json'), '{}');
      expect(() =>
        validateStaging({
          stagingRoot: root,
          target: 'linux-x64',
          runtime: 'node',
          contract: {
            vsix: {
              allowedApplicationFiles: ['package.json'],
              allowedTreeSitterFiles: [],
              allowedSqliteFiles: [],
              nativeBindings: { 'linux-x64': [] },
            },
          },
        }),
      ).not.toThrow();
      await writeFile(path.join(root, 'unexpected.log'), 'nope');
      expect(() =>
        validateStaging({
          stagingRoot: root,
          target: 'linux-x64',
          runtime: 'node',
          contract: {
            vsix: {
              allowedApplicationFiles: ['package.json'],
              allowedTreeSitterFiles: [],
              allowedSqliteFiles: [],
              nativeBindings: { 'linux-x64': [] },
            },
          },
        }),
      ).toThrow(/unexpected\.log/u);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function firstManifestPathFor(root: string): string {
  return path.join(root, '..', `${path.basename(root)}.json`);
}
