import { describe, expect, it } from 'vitest';
import { isErr } from '@project-dna/shared';
import { RepositoryGraph, type ImpactResult } from '@project-dna/dna-core';
import { ImpactEngine } from '../index.js';

const engine = new ImpactEngine();

describe('ImpactEngine structural file impact', () => {
  it('calculates a chain with direct and transitive dependents', () => {
    const graph = graphWithFiles(['A.ts', 'B.ts', 'C.ts']);
    connect(graph, 'A.ts', 'B.ts');
    connect(graph, 'B.ts', 'C.ts', { type: 'type-import', isTypeOnly: true });

    const result = impact(graph, { kind: 'file', path: 'C.ts' }, { maxEvidencePaths: 2 });

    expect(result.target.id).toBe('file:C.ts');
    expect(result.directImpactedEntities.map((node) => [node.id, node.minimumDepth])).toEqual([
      ['file:B.ts', 1],
    ]);
    expect(result.transitiveImpactedEntities.map((node) => [node.id, node.minimumDepth])).toEqual([
      ['file:A.ts', 2],
    ]);
    expect(result.minimumDepth).toBe(1);
    expect(result.canonicalPaths).toEqual([
      {
        impactedEntityId: 'file:A.ts',
        nodeIds: ['file:C.ts', 'file:B.ts', 'file:A.ts'],
        relationships: [
          relationship('file:B.ts', 'file:C.ts', { type: 'type-import', isTypeOnly: true }),
          relationship('file:A.ts', 'file:B.ts'),
        ],
      },
      {
        impactedEntityId: 'file:B.ts',
        nodeIds: ['file:C.ts', 'file:B.ts'],
        relationships: [
          relationship('file:B.ts', 'file:C.ts', { type: 'type-import', isTypeOnly: true }),
        ],
      },
    ]);
  });

  it('follows incoming edges for fan-out and fan-in', () => {
    const fanOut = graphWithFiles(['A.ts', 'B.ts', 'C.ts', 'D.ts']);
    connect(fanOut, 'A.ts', 'B.ts');
    connect(fanOut, 'A.ts', 'C.ts');
    connect(fanOut, 'A.ts', 'D.ts');
    expect(
      impact(fanOut, { kind: 'file', path: 'B.ts' }).directImpactedEntities.map((node) => node.id),
    ).toEqual(['file:A.ts']);

    const fanIn = graphWithFiles(['A.ts', 'B.ts', 'C.ts', 'X.ts']);
    connect(fanIn, 'A.ts', 'X.ts');
    connect(fanIn, 'B.ts', 'X.ts');
    connect(fanIn, 'C.ts', 'X.ts');
    expect(
      impact(fanIn, { kind: 'entity', id: 'file:X.ts' }).directImpactedEntities.map(
        (node) => node.id,
      ),
    ).toEqual(['file:A.ts', 'file:B.ts', 'file:C.ts']);
  });

  it('terminates cycles and never returns the target', () => {
    const graph = graphWithFiles(['A.ts', 'B.ts', 'C.ts']);
    connect(graph, 'A.ts', 'B.ts');
    connect(graph, 'B.ts', 'C.ts');
    connect(graph, 'C.ts', 'A.ts');

    const result = impact(graph, { kind: 'file', path: 'A.ts' });
    expect(result.directImpactedEntities.map((node) => node.id)).toEqual(['file:C.ts']);
    expect(result.transitiveImpactedEntities.map((node) => node.id)).toEqual(['file:B.ts']);
    expect(
      result.directImpactedEntities
        .concat(result.transitiveImpactedEntities)
        .map((node) => node.id),
    ).not.toContain('file:A.ts');
  });

  it('preserves merged relationship metadata and canonical ordering across insertion orders', () => {
    const first = graphWithFiles(['D.ts', 'C.ts', 'B.ts', 'A.ts']);
    const second = graphWithFiles(['A.ts', 'B.ts', 'C.ts', 'D.ts']);
    for (const graph of [first, second]) {
      connect(graph, 'B.ts', 'D.ts');
      connect(graph, 'B.ts', 'D.ts', {
        type: 'type-import',
        isTypeOnly: true,
        specifierCount: 2,
      });
      connect(graph, 'C.ts', 'D.ts');
      connect(graph, 'A.ts', 'B.ts');
      connect(graph, 'A.ts', 'C.ts');
    }

    const firstResult = impact(first, { kind: 'file', path: 'D.ts' });
    const secondResult = impact(second, { kind: 'file', path: 'D.ts' });
    expect(firstResult).toEqual(secondResult);
    expect(
      firstResult.canonicalPaths.find((path) => path.impactedEntityId === 'file:A.ts'),
    ).toEqual({
      impactedEntityId: 'file:A.ts',
      nodeIds: ['file:D.ts', 'file:B.ts', 'file:A.ts'],
      relationships: [
        relationship('file:B.ts', 'file:D.ts', { specifierCount: 3 }),
        relationship('file:A.ts', 'file:B.ts'),
      ],
    });
  });

  it('honors depth and entity bounds with explicit truncation', () => {
    const graph = graphWithFiles(['A.ts', 'B.ts', 'C.ts', 'D.ts']);
    connect(graph, 'A.ts', 'B.ts');
    connect(graph, 'B.ts', 'D.ts');
    connect(graph, 'C.ts', 'D.ts');

    const depth = impact(
      graph,
      { kind: 'file', path: 'D.ts' },
      { maxDepth: 1, maxEvidencePaths: 3 },
    );
    expect(depth.complete).toBe(false);
    expect(depth.truncations).toEqual([{ kind: 'max-depth', limit: 1, atEntityId: 'file:A.ts' }]);
    expect(depth.transitiveImpactedEntities).toEqual([]);

    const entities = impact(graph, { kind: 'file', path: 'D.ts' }, { maxEntities: 1 });
    expect(entities.complete).toBe(false);
    expect(entities.truncations).toEqual([
      { kind: 'max-entities', limit: 1, atEntityId: 'file:C.ts' },
    ]);
    expect(entities.directImpactedEntities).toHaveLength(1);

    const evidence = impact(graph, { kind: 'file', path: 'D.ts' }, { maxEvidencePaths: 1 });
    expect(evidence.complete).toBe(false);
    expect(evidence.truncations).toEqual([
      { kind: 'max-evidence-paths', limit: 1, atEntityId: 'file:B.ts' },
    ]);
    expect(evidence.canonicalPaths).toHaveLength(1);
    expect(evidence.evidence.filter((item) => item.path !== null)).toHaveLength(1);
    expect(evidence.evidence.find((item) => item.entityId === 'file:B.ts')?.path).toBeNull();
  });

  it('rejects missing and unsupported targets and honors cancellation', () => {
    const graph = graphWithFiles(['A.ts']);
    graph.addModuleNode('module:src', { label: 'src', path: 'src' });
    expectFailure(graph, { kind: 'file', path: 'missing.ts' }, 'does not resolve');
    expectFailure(graph, { kind: 'entity', id: 'module:src' }, 'supported');
    expectFailure(
      graph,
      { kind: 'class', id: 'class:Thing' } as never,
      'Unsupported impact target kind',
    );

    const controller = new AbortController();
    controller.abort();
    expectFailure(graph, { kind: 'file', path: 'A.ts' }, 'cancelled', controller.signal);
  });

  it('terminates when cancellation arrives during traversal expansion', () => {
    const graph = graphWithFiles(['A.ts', 'B.ts', 'C.ts', 'D.ts']);
    connect(graph, 'A.ts', 'B.ts');
    connect(graph, 'B.ts', 'C.ts');
    connect(graph, 'C.ts', 'D.ts');
    let checks = 0;
    const signal = {
      get aborted() {
        checks += 1;
        return checks > 5;
      },
    } as AbortSignal;

    expectFailure(graph, { kind: 'file', path: 'D.ts' }, 'cancelled', signal);
    expect(checks).toBeGreaterThan(5);
  });

  it('accepts canonical file entity IDs and keeps result ordering stable', () => {
    const graph = graphWithFiles(['A.ts', 'B.ts']);
    connect(graph, 'A.ts', 'B.ts');
    const result = impact(graph, { kind: 'entity', id: 'file:B.ts' });
    expect(result.directImpactedEntities.map((node) => node.id)).toEqual(['file:A.ts']);
    expect(new Set(result.directImpactedEntities.map((node) => node.id)).size).toBe(1);
  });
});

function impact(
  graph: RepositoryGraph,
  target: Parameters<ImpactEngine['getImpact']>[1],
  options: Parameters<ImpactEngine['getImpact']>[2] = {},
  signal?: AbortSignal,
): ImpactResult {
  const result = engine.getImpact(
    { repositoryId: 'repo:fixture', analysisVersion: 1, graph },
    target,
    options,
    signal,
  );
  if (isErr(result)) throw result.error;
  return result.value;
}

function expectFailure(
  graph: RepositoryGraph,
  target: Parameters<ImpactEngine['getImpact']>[1],
  message: string,
  signal?: AbortSignal,
): void {
  const result = engine.getImpact(
    { repositoryId: 'repo:fixture', analysisVersion: 1, graph },
    target,
    {},
    signal,
  );
  expect(result).toMatchObject({ ok: false, error: { message: expect.stringContaining(message) } });
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
  overrides: Partial<
    NonNullable<ImpactResult['canonicalPaths'][number]>['relationships'][number]
  > = {},
) {
  return {
    dependentId,
    dependencyId,
    type: 'import' as const,
    isTypeOnly: false,
    specifierCount: 1,
    ...overrides,
  };
}
