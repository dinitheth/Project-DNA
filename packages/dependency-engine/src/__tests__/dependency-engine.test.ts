import { describe, expect, it } from 'vitest';
import { FileDNASchema, RepositoryGraph, type FileDNA } from '@project-dna/dna-core';
import { createSilentLogger, isErr } from '@project-dna/shared';
import { DependencyEngine } from '../dependency-engine.js';
import { ModuleBoundaryAnalyzer } from '../analyzers/module-boundary-analyzer.js';

describe('DependencyEngine', () => {
  it('resolves internal, aliased, workspace, dynamic, re-export, and external dependencies', async () => {
    const files = [
      file(
        'src/index.ts',
        [
          imported('./service', 1),
          imported('@/shared', 1),
          imported('@project-dna/shared', 1),
          imported('react', 1),
          imported('./lazy', 0, true),
        ],
        [{ name: '*', type: 'barrel', isTypeOnly: false, source: './types' }],
      ),
      file('src/service.ts', [imported('./shared', 2), imported('./shared', 1, false, true)]),
      file('src/shared.ts'),
      file('src/lazy.ts'),
      file('src/types/index.ts'),
      file('packages/shared/src/index.ts'),
    ];

    const result = await new DependencyEngine(createSilentLogger()).buildDependencyGraph(
      files,
      'C:/repo',
    );
    if (isErr(result)) throw result.error;
    const graph = result.value;

    expect(graph.getNodesByKind('file')).toHaveLength(6);
    expect(graph.getNodesByKind('external')).toEqual(['external:react']);
    expect(graph.getDependencies('src/index.ts')).toEqual(
      expect.arrayContaining([
        'src/service.ts',
        'src/shared.ts',
        'packages/shared/src/index.ts',
        'external:react',
        'src/lazy.ts',
        'src/types/index.ts',
      ]),
    );
    expect(graph.getEdgeAttributes('src/index.ts', 'src/lazy.ts')).toMatchObject({
      type: 'dynamic-import',
      isExternal: false,
    });
    expect(graph.getEdgeAttributes('src/index.ts', 'src/types/index.ts')).toMatchObject({
      type: 're-export',
    });
    expect(graph.getEdgeAttributes('src/service.ts', 'src/shared.ts')).toEqual({
      type: 'import',
      isTypeOnly: false,
      specifierCount: 3,
      isExternal: false,
    });
  });

  it('detects file dependency cycles but excludes external nodes', async () => {
    const files = [
      file('src/a.ts', [imported('./b', 1)]),
      file('src/b.ts', [imported('./c', 1), imported('react', 1)]),
      file('src/c.ts', [imported('./a', 1)]),
    ];
    const engine = new DependencyEngine(createSilentLogger());
    const result = await engine.buildDependencyGraph(files, 'C:/repo');
    if (isErr(result)) throw result.error;

    expect(engine.detectCircularDependencies(result.value)).toEqual([
      { chain: ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/a.ts'], length: 3 },
    ]);
  });

  it('honors cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await new DependencyEngine(createSilentLogger()).buildDependencyGraph(
      [file('src/a.ts')],
      'C:/repo',
      controller.signal,
    );
    expect(isErr(result)).toBe(true);
  });

  it.each([
    ['Windows', 'C:/repo'],
    ['POSIX', '/repo'],
  ])(
    'repairs changed source edges for %s absolute paths while preserving a complete graph',
    async (_platform, rootPath) => {
      const engine = new DependencyEngine(createSilentLogger());
      const previousFiles = [
        file('src/a.ts', [imported('./b', 1)]),
        file('src/b.ts'),
        file('src/c.ts'),
      ];
      const initial = await engine.buildDependencyGraph(previousFiles, rootPath);
      if (isErr(initial)) throw initial.error;

      const currentFiles = [
        file('src/a.ts', [imported('./c', 1)]),
        file('src/b.ts'),
        file('src/c.ts'),
      ];
      const repaired = await engine.buildDependencyGraphIncremental?.({
        files: currentFiles,
        previousFiles,
        previousGraph: initial.value,
        rootPath,
        changedPaths: [`${rootPath}/src/a.ts`],
      });
      if (!repaired || isErr(repaired)) throw repaired?.error ?? new Error('Repair unavailable');

      expect(repaired.value.getDependencies('src/a.ts')).toEqual(['src/c.ts']);
      expect(repaired.value.getDependents('src/b.ts')).toEqual([]);
      expect(repaired.value.getDependents('src/c.ts')).toEqual(['src/a.ts']);
    },
  );
});

describe('ModuleBoundaryAnalyzer', () => {
  it('summarizes internal, cross-module, and external edges', () => {
    const graph = new RepositoryGraph();
    graph.addFileNode('packages/a/src/index.ts', { label: 'index.ts' });
    graph.addFileNode('packages/a/src/local.ts', { label: 'local.ts' });
    graph.addFileNode('packages/b/src/index.ts', { label: 'index.ts' });
    graph.addExternalNode('external:react', 'react');
    graph.addDependency('packages/a/src/index.ts', 'packages/a/src/local.ts', edge());
    graph.addDependency('packages/a/src/index.ts', 'packages/b/src/index.ts', edge());
    graph.addDependency('packages/a/src/index.ts', 'external:react', edge(true));

    expect(new ModuleBoundaryAnalyzer().analyze(graph)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          moduleName: 'packages/a',
          internalDependencies: ['packages/a/src/local.ts'],
          crossModuleImports: ['packages/b:packages/b/src/index.ts'],
          externalImports: ['react'],
        }),
      ]),
    );
  });
});

function file(
  path: string,
  imports: FileDNA['imports'] = [],
  exports: FileDNA['exports'] = [],
): FileDNA {
  return FileDNASchema.parse({
    id: path,
    path,
    language: 'typescript',
    hash: path,
    size: 1,
    linesOfCode: 1,
    classIds: [],
    functionIds: [],
    imports,
    exports,
    comments: [],
    complexity: 1,
  });
}

function imported(
  source: string,
  specifierCount: number,
  isDynamic = false,
  isTypeOnly = false,
): FileDNA['imports'][number] {
  return {
    source,
    specifiers: Array.from({ length: specifierCount }, (_, index) => ({
      name: `symbol${index}`,
      isDefault: false,
      isNamespace: false,
    })),
    isTypeOnly,
    isDynamic,
  };
}

function edge(isExternal = false) {
  return {
    type: 'import' as const,
    isTypeOnly: false,
    specifierCount: 1,
    isExternal,
  };
}
