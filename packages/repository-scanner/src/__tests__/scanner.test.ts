import { mkdir, mkdtemp, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSilentLogger, isErr } from '@project-dna/shared';
import { RepositoryScanner } from '../scanner.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('RepositoryScanner', () => {
  it('returns repository metadata and a source-file manifest', async () => {
    const rootPath = await mkdtemp(path.join(tmpdir(), 'project-dna-scanner-'));
    temporaryDirectories.push(rootPath);
    await mkdir(path.join(rootPath, 'src'), { recursive: true });
    await mkdir(path.join(rootPath, 'dist'), { recursive: true });
    await writeFile(
      path.join(rootPath, 'package.json'),
      JSON.stringify({ name: 'fixture', version: '1.2.3', dependencies: { react: '^18.0.0' } }),
    );
    await writeFile(path.join(rootPath, 'pnpm-lock.yaml'), 'lockfileVersion: 9');
    await writeFile(path.join(rootPath, 'README.md'), '# Fixture');
    await writeFile(path.join(rootPath, '.gitignore'), 'ignored.ts\n');
    await writeFile(path.join(rootPath, 'src', 'index.ts'), 'export const value = 1;\n');
    await writeFile(path.join(rootPath, 'src', 'App.tsx'), 'export const App = () => null;\n');
    await writeFile(path.join(rootPath, 'ignored.ts'), 'export const ignored = true;\n');
    await writeFile(path.join(rootPath, 'dist', 'bundle.js'), 'ignored');

    const result = await new RepositoryScanner(createSilentLogger()).scan(rootPath);
    if (isErr(result)) throw result.error;

    expect(result.value.repository.name).toBe(path.basename(rootPath));
    expect(result.value.repository.packageManager).toBe('pnpm');
    expect(result.value.repository.metadata).toMatchObject({
      hasReadme: true,
      hasPackageJson: true,
      version: '1.2.3',
    });
    expect(result.value.repository.frameworks).toEqual([
      { name: 'React', version: '^18.0.0', confidence: 1 },
    ]);
    expect(result.value.files.map((file) => file.relativePath)).toEqual([
      'src/App.tsx',
      'src/index.ts',
    ]);
    expect(result.value.manifest?.map((file) => file.relativePath)).toEqual([
      '.gitignore',
      'package.json',
      'README.md',
      'src/App.tsx',
      'src/index.ts',
    ]);
  });

  it('reconciles created, modified, deleted, and unsupported files deterministically', async () => {
    const rootPath = await mkdtemp(path.join(tmpdir(), 'project-dna-scanner-incremental-'));
    temporaryDirectories.push(rootPath);
    await mkdir(path.join(rootPath, 'src'), { recursive: true });
    const existingPath = path.join(rootPath, 'src', 'existing.ts');
    const deletedPath = path.join(rootPath, 'src', 'deleted.ts');
    await writeFile(existingPath, 'export const value = 1;\n');
    await writeFile(deletedPath, 'export const removed = true;\n');

    const scanner = new RepositoryScanner(createSilentLogger());
    const initial = await scanner.scan(rootPath);
    if (isErr(initial)) throw initial.error;

    const createdPath = path.join(rootPath, 'src', 'created.ts');
    const unsupportedPath = path.join(rootPath, 'notes.md');
    await writeFile(existingPath, 'export const value = 2;\nexport const next = 3;\n');
    await writeFile(createdPath, 'export const created = true;\n');
    await writeFile(unsupportedPath, '# Notes\n');
    await unlink(deletedPath);

    const result = await scanner.scanIncremental({
      rootPath,
      previous: initial.value,
      changedPaths: [unsupportedPath, deletedPath, createdPath, existingPath, existingPath],
    });
    if (isErr(result)) throw result.error;

    expect(result.value.files.map((file) => file.relativePath)).toEqual([
      'src/created.ts',
      'src/existing.ts',
    ]);
    expect(result.value.manifest?.map((file) => file.relativePath)).toEqual([
      'notes.md',
      'src/created.ts',
      'src/existing.ts',
    ]);
    expect(result.value.repository.totalFiles).toBe(3);
    expect(result.value.repository.totalLinesOfCode).toBe(3);
  });

  it('falls back to a full scan when configuration can change repository membership', async () => {
    const rootPath = await mkdtemp(path.join(tmpdir(), 'project-dna-scanner-config-'));
    temporaryDirectories.push(rootPath);
    const ignoredPath = path.join(rootPath, 'ignored.ts');
    const gitIgnorePath = path.join(rootPath, '.gitignore');
    await writeFile(gitIgnorePath, 'ignored.ts\n');
    await writeFile(ignoredPath, 'export const ignored = true;\n');

    const scanner = new RepositoryScanner(createSilentLogger());
    const initial = await scanner.scan(rootPath);
    if (isErr(initial)) throw initial.error;
    expect(initial.value.files).toHaveLength(0);

    await writeFile(gitIgnorePath, '');
    const result = await scanner.scanIncremental({
      rootPath,
      previous: initial.value,
      changedPaths: [gitIgnorePath],
    });
    if (isErr(result)) throw result.error;

    expect(result.value.files.map((file) => file.relativePath)).toEqual(['ignored.ts']);
  });

  it('falls back to a full scan for directory-level changes', async () => {
    const rootPath = await mkdtemp(path.join(tmpdir(), 'project-dna-scanner-directory-'));
    temporaryDirectories.push(rootPath);
    const previousDirectory = path.join(rootPath, 'src', 'previous');
    const nextDirectory = path.join(rootPath, 'src', 'next');
    await mkdir(previousDirectory, { recursive: true });
    await writeFile(path.join(previousDirectory, 'value.ts'), 'export const value = true;\n');

    const scanner = new RepositoryScanner(createSilentLogger());
    const initial = await scanner.scan(rootPath);
    if (isErr(initial)) throw initial.error;
    await rename(previousDirectory, nextDirectory);

    const result = await scanner.scanIncremental({
      rootPath,
      previous: initial.value,
      changedPaths: [previousDirectory, nextDirectory],
    });
    if (isErr(result)) throw result.error;
    expect(result.value.files.map((file) => file.relativePath)).toEqual(['src/next/value.ts']);
  });

  it('honors cancellation before scanning', async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await new RepositoryScanner(createSilentLogger()).scan('.', controller.signal);
    expect(isErr(result)).toBe(true);
  });
});
