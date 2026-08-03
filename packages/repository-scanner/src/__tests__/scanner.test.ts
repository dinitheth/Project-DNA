import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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
  });

  it('honors cancellation before scanning', async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await new RepositoryScanner(createSilentLogger()).scan('.', controller.signal);
    expect(isErr(result)).toBe(true);
  });
});
