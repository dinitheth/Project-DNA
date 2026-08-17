import { describe, expect, it } from 'vitest';
import { isErr } from '@project-dna/shared';
import {
  RepositoryGraph,
  traverseDependencyGraph,
  type DependencyTraversalOptions,
  type ImpactRelationship,
} from '../index.js';

const DEFAULT_OPTIONS: DependencyTraversalOptions = {
  direction: 'dependents',
  maxDepth: 8,
  maxEntities: 500,
};

describe('dependency traversal', () => {
  it('follows importer dependents with minimum depth and canonical predecessors', () => {
    const graph = graphWithFiles(['A.ts', 'B.ts', 'C.ts']);
    connect(graph, 'A.ts', 'B.ts');
    connect(graph, 'B.ts', 'C.ts', { type: 'type-import', isTypeOnly: true });

    expect(traverse(graph, 'C.ts')).toEqual({
      startIds: ['C.ts'],
      nodes: [
        {
          id: 'A.ts',
          minimumDepth: 2,
          predecessorId: 'B.ts',
          relationship: relationship('A.ts', 'B.ts'),
        },
        {
          id: 'B.ts',
          minimumDepth: 1,
          predecessorId: 'C.ts',
          relationship: relationship('B.ts', 'C.ts', {
            type: 'type-import',
            isTypeOnly: true,
          }),
        },
      ],
      complete: true,
      truncations: [],
    });
  });

  it('uses directed fan-in semantics and excludes dependencies of the target', () => {
    const graph = graphWithFiles(['A.ts', 'B.ts', 'C.ts', 'D.ts', 'X.ts']);
    connect(graph, 'A.ts', 'X.ts');
    connect(graph, 'B.ts', 'X.ts');
    connect(graph, 'C.ts', 'X.ts');
    connect(graph, 'A.ts', 'D.ts');

    expect(traverse(graph, 'X.ts').nodes.map(({ id }) => id)).toEqual(['A.ts', 'B.ts', 'C.ts']);
    expect(traverse(graph, 'A.ts').nodes).toEqual([]);
  });

  it('terminates cycles without returning a start node or duplicates', () => {
    const graph = graphWithFiles(['A.ts', 'B.ts', 'C.ts']);
    connect(graph, 'A.ts', 'B.ts');
    connect(graph, 'B.ts', 'C.ts');
    connect(graph, 'C.ts', 'A.ts');

    const result = traverse(graph, 'A.ts');
    expect(result.nodes.map(({ id }) => id)).toEqual(['B.ts', 'C.ts']);
    expect(new Set(result.nodes.map(({ id }) => id)).size).toBe(result.nodes.length);
  });

  it('preserves merged relationship metadata from the repository graph', () => {
    const graph = graphWithFiles(['A.ts', 'B.ts']);
    connect(graph, 'A.ts', 'B.ts', {
      type: 'type-import',
      isTypeOnly: true,
      specifierCount: 1,
    });
    connect(graph, 'A.ts', 'B.ts', {
      type: 'import',
      isTypeOnly: false,
      specifierCount: 2,
    });

    expect(traverse(graph, 'B.ts').nodes[0]?.relationship).toEqual(
      relationship('A.ts', 'B.ts', {
        type: 'import',
        isTypeOnly: false,
        specifierCount: 3,
      }),
    );
  });

  it('reports deterministic depth and entity truncation', () => {
    const graph = graphWithFiles(['A.ts', 'B.ts', 'C.ts', 'D.ts']);
    connect(graph, 'A.ts', 'B.ts');
    connect(graph, 'B.ts', 'D.ts');
    connect(graph, 'C.ts', 'D.ts');

    const depthBounded = traverse(graph, 'D.ts', { maxDepth: 1 });
    expect(depthBounded.nodes.map(({ id }) => id)).toEqual(['B.ts', 'C.ts']);
    expect(depthBounded).toMatchObject({
      complete: false,
      truncations: [{ kind: 'max-depth', limit: 1, atEntityId: 'A.ts' }],
    });

    const entityBounded = traverse(graph, 'D.ts', { maxEntities: 1 });
    expect(entityBounded.nodes.map(({ id }) => id)).toEqual(['B.ts']);
    expect(entityBounded).toMatchObject({
      complete: false,
      truncations: [{ kind: 'max-entities', limit: 1, atEntityId: 'C.ts' }],
    });
  });

  it('selects the same canonical shortest path regardless of insertion order', () => {
    const edges = [
      ['B.ts', 'D.ts'],
      ['C.ts', 'D.ts'],
      ['A.ts', 'B.ts'],
      ['A.ts', 'C.ts'],
    ] as const;
    const first = graphWithFiles(['D.ts', 'C.ts', 'B.ts', 'A.ts']);
    const second = graphWithFiles(['A.ts', 'B.ts', 'C.ts', 'D.ts']);
    for (const [dependent, dependency] of edges) connect(first, dependent, dependency);
    for (const [dependent, dependency] of [...edges].reverse())
      connect(second, dependent, dependency);

    expect(traverse(first, 'D.ts')).toEqual(traverse(second, 'D.ts'));
    expect(traverse(first, 'D.ts').nodes.find(({ id }) => id === 'A.ts')?.predecessorId).toBe(
      'B.ts',
    );
  });

  it('excludes external nodes and rejects missing or unsupported targets', () => {
    const graph = graphWithFiles(['A.ts']);
    graph.addExternalNode('external:react', 'react');
    graph.addModuleNode('module:src', { label: 'src', path: 'src' });
    connect(graph, 'A.ts', 'external:react', { isExternal: true });

    expect(traverse(graph, 'A.ts').nodes).toEqual([]);
    expect(() => traverse(graph, 'missing.ts')).toThrow('target not found');
    expect(() => traverse(graph, 'module:src')).toThrow('only supports file nodes');
    expect(() => traverse(graph, 'module:src', { missingStartNode: 'ignore' })).toThrow(
      'only supports file nodes',
    );
  });

  it('supports a deterministic connected closure across graph generations', () => {
    const previous = graphWithFiles(['A.ts', 'B.ts', 'C.ts']);
    connect(previous, 'A.ts', 'B.ts');
    connect(previous, 'B.ts', 'C.ts');
    const current = graphWithFiles(['A.ts', 'B.ts', 'D.ts']);
    connect(current, 'A.ts', 'B.ts');
    connect(current, 'B.ts', 'D.ts');

    const result = traverseDependencyGraph({
      graphs: [previous, current],
      startIds: ['C.ts'],
      options: { direction: 'connected', maxDepth: 4, maxEntities: 4 },
    });
    if (isErr(result)) throw result.error;
    expect(result.value.nodes.map(({ id }) => id)).toEqual(['A.ts', 'B.ts', 'D.ts']);
  });

  it('honors cancellation before traversal', () => {
    const graph = graphWithFiles(['A.ts']);
    const controller = new AbortController();
    controller.abort();

    const result = traverseDependencyGraph(
      { graphs: [graph], startIds: ['A.ts'], options: DEFAULT_OPTIONS },
      controller.signal,
    );
    expect(result).toMatchObject({
      ok: false,
      error: { message: 'Dependency traversal cancelled' },
    });
  });

  it('checks cancellation while expanding the graph', () => {
    const graph = graphWithFiles(['A.ts', 'B.ts', 'C.ts']);
    connect(graph, 'A.ts', 'B.ts');
    connect(graph, 'B.ts', 'C.ts');
    let checks = 0;
    const signal = {
      get aborted() {
        checks += 1;
        return checks > 5;
      },
    } as AbortSignal;

    const result = traverseDependencyGraph(
      { graphs: [graph], startIds: ['C.ts'], options: DEFAULT_OPTIONS },
      signal,
    );
    expect(result).toMatchObject({
      ok: false,
      error: { message: 'Dependency traversal cancelled' },
    });
  });

  it('rejects unsafe traversal bounds', () => {
    const graph = graphWithFiles(['A.ts']);
    const result = traverseDependencyGraph({
      graphs: [graph],
      startIds: ['A.ts'],
      options: { ...DEFAULT_OPTIONS, maxEntities: Number.MAX_SAFE_INTEGER + 1 },
    });

    expect(result).toMatchObject({
      ok: false,
      error: { message: 'Dependency traversal maxEntities must be a safe positive integer' },
    });
  });
});

function traverse(
  graph: RepositoryGraph,
  startId: string,
  overrides: Partial<DependencyTraversalOptions> = {},
) {
  const result = traverseDependencyGraph({
    graphs: [graph],
    startIds: [startId],
    options: { ...DEFAULT_OPTIONS, ...overrides },
  });
  if (isErr(result)) throw result.error;
  return result.value;
}

function graphWithFiles(ids: readonly string[]): RepositoryGraph {
  const graph = new RepositoryGraph();
  for (const id of ids) graph.addFileNode(id, { label: id, path: id });
  return graph;
}

function connect(
  graph: RepositoryGraph,
  dependentId: string,
  dependencyId: string,
  overrides: Partial<Parameters<RepositoryGraph['addDependency']>[2]> = {},
): void {
  graph.addDependency(dependentId, dependencyId, {
    type: 'import',
    isTypeOnly: false,
    specifierCount: 1,
    isExternal: false,
    ...overrides,
  });
}

function relationship(
  dependentId: string,
  dependencyId: string,
  overrides: Partial<ImpactRelationship> = {},
): ImpactRelationship {
  return {
    dependentId,
    dependencyId,
    type: 'import' as const,
    isTypeOnly: false,
    specifierCount: 1,
    ...overrides,
  };
}
