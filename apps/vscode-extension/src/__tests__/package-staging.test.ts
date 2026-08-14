import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';

const requireScript = createRequire(path.resolve(__dirname, 'package-staging.test.cjs'));
const vsceRequire = createRequire(requireScript.resolve('@vscode/vsce/package.json'));
const yauzl = vsceRequire('yauzl') as {
  readonly open: (
    path: string,
    options: { readonly lazyEntries: boolean },
    callback: (error: Error | null, zipFile?: ZipFile) => void,
  ) => void;
};
const { SQLITE_FILES, copyApplicationFile, normalizeRelative, normalizeStagingTree } =
  requireScript('../../scripts/stage-extension.mjs') as {
    readonly SQLITE_FILES: readonly string[];
    readonly copyApplicationFile: (stagingRoot: string, relativePath: string) => void;
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
    readonly packagePath?: string;
  }) => {
    readonly files: readonly {
      readonly path: string;
      readonly size: number;
      readonly sha256: string;
    }[];
    readonly packageSha256?: string;
  };
};
const { comparePackages, createVsixFromStaging, validateStaging } = requireScript(
  '../../scripts/validate-package.mjs',
) as {
  readonly comparePackages: (firstPath: string, secondPath: string) => void;
  readonly createVsixFromStaging: (options: {
    readonly stagingRoot: string;
    readonly stagedFiles: readonly string[];
    readonly outputPath: string;
    readonly target: string;
    readonly sourceDateEpoch: string;
  }) => Promise<readonly string[]>;
  readonly validateStaging: (options: {
    readonly stagingRoot: string;
    readonly contract: ReleaseContract;
    readonly target: string;
    readonly runtime: string;
  }) => { readonly files: readonly string[]; readonly sha256: string };
};

interface ZipEntry {
  readonly fileName: string;
}

interface ZipFile {
  readEntry(): void;
  close(): void;
  openReadStream(entry: ZipEntry, listener: (error: Error | null, stream?: Readable) => void): void;
  on(event: 'entry', listener: (entry: ZipEntry) => void): void;
  on(event: 'end', listener: () => void): void;
  on(event: 'error', listener: (error: Error) => void): void;
}

interface ReleaseContract {
  readonly vsix: {
    readonly allowedApplicationFiles: readonly string[];
    readonly allowedTreeSitterFiles: readonly string[];
    readonly allowedSqliteFiles: readonly string[];
    readonly nativeBindings: Readonly<Record<string, readonly string[]>>;
  };
}

const extensionRoot = path.resolve(__dirname, '../..');
const releaseContract = JSON.parse(
  readFileSync(path.join(extensionRoot, 'release-contract.json'), 'utf8'),
) as ReleaseContract;

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

  it('stages the repository MIT license without duplicating its source', async () => {
    const stagingRoot = await mkdtemp(path.join(tmpdir(), 'project-dna-license-'));
    try {
      copyApplicationFile(stagingRoot, 'LICENSE.txt');
      expect(await readFile(path.join(stagingRoot, 'LICENSE.txt'))).toEqual(
        await readFile(path.resolve(extensionRoot, '../../LICENSE')),
      );
    } finally {
      await rm(stagingRoot, { recursive: true, force: true });
    }
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

  it('emits the exact Marketplace target in each platform VSIX manifest', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'project-dna-target-platform-'));
    const stagingRoot = path.join(root, 'staging');
    try {
      await mkdir(stagingRoot, { recursive: true });
      await writeFile(path.join(stagingRoot, 'package.json'), createMinimalStagedManifest());
      normalizeStagingTree(stagingRoot, 0);
      for (const target of Object.keys(releaseContract.vsix.nativeBindings)) {
        const vsixPath = path.join(root, `${target}.vsix`);
        const extractedRoot = path.join(root, `extracted-${target}`);
        await createVsixFromStaging({
          stagingRoot,
          stagedFiles: ['package.json'],
          outputPath: vsixPath,
          target,
          sourceDateEpoch: '315532800',
        });
        await extractZip(vsixPath, extractedRoot);
        const manifest = await readFile(path.join(extractedRoot, 'extension.vsixmanifest'), 'utf8');
        expect(manifest).toContain(`TargetPlatform="${target}"`);
        expect(manifest.match(/TargetPlatform=/gu)).toHaveLength(1);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('packages the exact validated runtime allowlist into deterministic VSIX archives', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'project-dna-vsix-'));
    const stagingRoot = path.join(root, 'staging');
    const firstVsix = path.join(root, 'first.vsix');
    const secondVsix = path.join(root, 'second.vsix');
    const integrityPath = path.join(root, 'integrity.json');
    const extractedRoot = path.join(root, 'extracted');
    const target = 'linux-x64';
    const expectedStagingFiles = [
      ...releaseContract.vsix.allowedApplicationFiles,
      ...releaseContract.vsix.allowedTreeSitterFiles,
      ...releaseContract.vsix.allowedSqliteFiles,
      ...(releaseContract.vsix.nativeBindings[target] ?? []),
    ].sort((a, b) => a.localeCompare(b));
    try {
      for (const relativePath of expectedStagingFiles) {
        const destination = path.join(stagingRoot, ...relativePath.split('/'));
        await mkdir(path.dirname(destination), { recursive: true });
        if (relativePath === 'LICENSE.txt') copyApplicationFile(stagingRoot, relativePath);
        else
          await writeFile(
            destination,
            relativePath === 'package.json' ? createStagedManifest() : `fixture:${relativePath}\n`,
          );
      }
      normalizeStagingTree(stagingRoot, 0);
      const validated = validateStaging({
        stagingRoot,
        contract: releaseContract,
        target,
        runtime: 'electron',
      });
      await createVsixFromStaging({
        stagingRoot,
        stagedFiles: validated.files,
        outputPath: firstVsix,
        target,
        sourceDateEpoch: '315532800',
      });
      await createVsixFromStaging({
        stagingRoot,
        stagedFiles: validated.files,
        outputPath: secondVsix,
        target,
        sourceDateEpoch: '315532800',
      });
      expect(() => comparePackages(firstVsix, secondVsix)).not.toThrow();
      const integrity = createIntegrityManifest({
        stagingRoot,
        outputPath: integrityPath,
        packagePath: firstVsix,
        metadata: { target, abi: '146' },
      });
      const licenseBytes = await readFile(path.join(stagingRoot, 'LICENSE.txt'));
      expect(
        integrity.files.find(({ path: relativePath }) => relativePath === 'LICENSE.txt'),
      ).toEqual({
        path: 'LICENSE.txt',
        size: licenseBytes.byteLength,
        sha256: createHash('sha256').update(licenseBytes).digest('hex'),
      });
      const entries = await readZipEntries(firstVsix);
      expect(entries).toEqual(
        [
          '[Content_Types].xml',
          'extension.vsixmanifest',
          ...expectedStagingFiles.map((relativePath) => `extension/${relativePath}`),
        ].sort((a, b) => a.localeCompare(b)),
      );
      expect(entries).toContain('extension/LICENSE.txt');
      expect(entries.filter((entry) => entry.startsWith('extension/node_modules/'))).toEqual(
        [...releaseContract.vsix.allowedTreeSitterFiles, ...releaseContract.vsix.allowedSqliteFiles]
          .map((relativePath) => `extension/${relativePath}`)
          .sort((a, b) => a.localeCompare(b)),
      );
      for (const nativeBinding of releaseContract.vsix.nativeBindings[target] ?? []) {
        expect(entries).toContain(`extension/${nativeBinding}`);
      }
      await extractZip(firstVsix, extractedRoot);
      const extractedExtension = path.join(extractedRoot, 'extension');
      expect(() =>
        validateStaging({
          stagingRoot: extractedExtension,
          contract: releaseContract,
          target,
          runtime: 'electron',
        }),
      ).not.toThrow();
      await rm(path.join(extractedExtension, 'LICENSE.txt'));
      expect(() =>
        validateStaging({
          stagingRoot: extractedExtension,
          contract: releaseContract,
          target,
          runtime: 'electron',
        }),
      ).toThrow(/missing=LICENSE\.txt/u);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

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

function createStagedManifest(): string {
  const manifest = JSON.parse(readFileSync(path.join(extensionRoot, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  manifest.dependencies = Object.fromEntries(
    Object.entries(manifest.dependencies ?? {}).filter(([name]) =>
      ['better-sqlite3', 'web-tree-sitter', 'tree-sitter-wasms'].includes(name),
    ),
  );
  delete manifest.devDependencies;
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function createMinimalStagedManifest(): string {
  return `${JSON.stringify(
    {
      name: 'project-dna-target-test',
      displayName: 'Project DNA Target Test',
      description: 'Targeted VSIX packaging fixture',
      version: '1.0.0',
      publisher: 'project-dna',
      engines: { vscode: '1.132.x' },
    },
    null,
    2,
  )}\n`;
}

function readZipEntries(filePath: string): Promise<readonly string[]> {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true }, (error, zipFile) => {
      if (error || !zipFile) {
        reject(error ?? new Error(`Could not open ${filePath}`));
        return;
      }
      const entries: string[] = [];
      zipFile.on('entry', (entry) => {
        entries.push(entry.fileName);
        zipFile.readEntry();
      });
      zipFile.on('error', reject);
      zipFile.on('end', () => {
        resolve(entries.sort((a, b) => a.localeCompare(b)));
      });
      zipFile.readEntry();
    });
  });
}

function extractZip(filePath: string, destinationRoot: string): Promise<void> {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true }, (error, zipFile) => {
      if (error || !zipFile) {
        reject(error ?? new Error(`Could not open ${filePath}`));
        return;
      }
      const fail = (cause: unknown) => {
        zipFile.close();
        reject(cause);
      };
      zipFile.on('entry', (entry) => {
        const destination = path.resolve(destinationRoot, entry.fileName);
        const relativePath = path.relative(destinationRoot, destination);
        if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
          fail(new Error(`Unsafe VSIX entry: ${entry.fileName}`));
          return;
        }
        if (entry.fileName.endsWith('/')) {
          void mkdir(destination, { recursive: true }).then(() => zipFile.readEntry(), fail);
          return;
        }
        zipFile.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) {
            fail(streamError ?? new Error(`Could not read ${entry.fileName}`));
            return;
          }
          void (async () => {
            await mkdir(path.dirname(destination), { recursive: true });
            const chunks: Buffer[] = [];
            for await (const chunk of stream) chunks.push(Buffer.from(chunk));
            await writeFile(destination, Buffer.concat(chunks));
            zipFile.readEntry();
          })().catch(fail);
        });
      });
      zipFile.on('error', reject);
      zipFile.on('end', resolve);
      zipFile.readEntry();
    });
  });
}
