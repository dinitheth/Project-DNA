import { describe, expect, it } from 'vitest';
import { isErr } from '@project-dna/shared';
import { RepositoryGraph, type ImpactResult } from '@project-dna/dna-core';
import { ImpactEngine } from '../index.js';

const engine = new ImpactEngine();

describe('ImpactEngine structural file impact', () => {
  it('calculates a chain with direct and transitive dependents', () => {
    const graph = graphWithFiles(['file:A.ts', 'file:B.ts', 'file:C.ts']);
    connect(graph, 'file:A.ts', 'file:B.ts');
    connect(graph, 'file:B.ts', 'file:C.ts', { type: 'type-import', isTypeOnly: true });

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
    const fanOut = graphWithFiles(['file:A.ts', 'file:B.ts', 'file:C.ts', 'file:D.ts']);
    connect(fanOut, 'file:A.ts', 'file:B.ts');
    connect(fanOut, 'file:A.ts', 'file:C.ts');
    connect(fanOut, 'file:A.ts', 'file:D.ts');
    expect(
      impact(fanOut, { kind: 'file', path: 'B.ts' }).directImpactedEntities.map((node) => node.id),
    ).toEqual(['file:A.ts']);

    const fanIn = graphWithFiles(['file:A.ts', 'file:B.ts', 'file:C.ts', 'file:X.ts']);
    connect(fanIn, 'file:A.ts', 'file:X.ts');
    connect(fanIn, 'file:B.ts', 'file:X.ts');
    connect(fanIn, 'file:C.ts', 'file:X.ts');
    expect(
      impact(fanIn, { kind: 'entity', id: 'file:X.ts' }).directImpactedEntities.map(
        (node) => node.id,
      ),
    ).toEqual(['file:A.ts', 'file:B.ts', 'file:C.ts']);
  });

  it('terminates cycles and never returns the target', () => {
    const graph = graphWithFiles(['file:A.ts', 'file:B.ts', 'file:C.ts']);
    connect(graph, 'file:A.ts', 'file:B.ts');
    connect(graph, 'file:B.ts', 'file:C.ts');
    connect(graph, 'file:C.ts', 'file:A.ts');

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
    const first = graphWithFiles(['file:D.ts', 'file:C.ts', 'file:B.ts', 'file:A.ts']);
    const second = graphWithFiles(['file:A.ts', 'file:B.ts', 'file:C.ts', 'file:D.ts']);
    for (const graph of [first, second]) {
      connect(graph, 'file:B.ts', 'file:D.ts');
      connect(graph, 'file:B.ts', 'file:D.ts', {
        type: 'type-import',
        isTypeOnly: true,
        specifierCount: 2,
      });
      connect(graph, 'file:C.ts', 'file:D.ts');
      connect(graph, 'file:A.ts', 'file:B.ts');
      connect(graph, 'file:A.ts', 'file:C.ts');
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
    const graph = graphWithFiles(['file:A.ts', 'file:B.ts', 'file:C.ts', 'file:D.ts']);
    connect(graph, 'file:A.ts', 'file:B.ts');
    connect(graph, 'file:B.ts', 'file:D.ts');
    connect(graph, 'file:C.ts', 'file:D.ts');

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
    const graph = graphWithFiles(['file:A.ts']);
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

  it('accepts canonical file entity IDs and keeps result ordering stable', () => {
    const graph = graphWithFiles(['file:A.ts', 'file:B.ts']);
    connect(graph, 'file:A.ts', 'file:B.ts');
    const result = impact(graph, { kind: 'entity', id: 'file:file:B.ts' });
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
  for (const id of ids)
    graph.addFileNode(id, { label: id.replace('file:', ''), path: id.replace('file:', '') });
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
