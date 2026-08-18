import { describe, expect, it } from 'vitest';
import { isErr } from '@project-dna/shared';
import {
  RepositoryGraph,
  type ArchitectureDNA,
  type BusinessDomain,
  type Capability,
  type CriticalComponent,
  type DNAObject,
  type ImpactResult,
  type RiskNode,
} from '@project-dna/dna-core';
import { ImpactEngine, type ImpactSemanticInput } from '../impact-engine.js';

const engine = new ImpactEngine();

describe('ImpactEngine explainable blast-radius scoring', () => {
  it('scores empty, direct, deep, and large dependent reach with saturating normalization', () => {
    expect(score(graph(['target.ts']), emptySemantic(), 'target.ts').score.total).toBe(0);

    const direct = graph(['dependent.ts', 'target.ts'], [['dependent.ts', 'target.ts']]);
    expect(
      component(score(direct, emptySemantic(), 'target.ts'), 'dependency-reach'),
    ).toMatchObject({
      rawInput: 1,
      normalizedValue: 0.5,
      weight: 0.35,
      contribution: 17.5,
      status: 'available',
    });

    const deep = graph(
      ['A.ts', 'B.ts', 'C.ts', 'target.ts'],
      [
        ['A.ts', 'B.ts'],
        ['B.ts', 'C.ts'],
        ['C.ts', 'target.ts'],
      ],
    );
    expect(component(score(deep, emptySemantic(), 'target.ts'), 'dependency-reach')).toMatchObject({
      rawInput: 3,
      normalizedValue: 0.75,
      contribution: 26.25,
    });

    const dependents = Array.from({ length: 20 }, (_, index) => `D${index}.ts`);
    const large = graph(
      [...dependents, 'target.ts'],
      dependents.map((dependent) => [dependent, 'target.ts'] as const),
    );
    const largeReach = component(score(large, emptySemantic(), 'target.ts'), 'dependency-reach');
    expect(largeReach.rawInput).toBe(20);
    expect(largeReach.normalizedValue).toBeCloseTo(20 / 21, 12);
    expect(largeReach.contribution).toBe(33.33);
  });

  it('calculates exact semantic component arithmetic and structured evidence', () => {
    const result = score(chainGraph(), semanticFixture(), 'C.ts');

    expect(component(result, 'dependency-reach')).toMatchObject({
      rawInput: 2,
      normalizedValue: 2 / 3,
      weight: 0.35,
      contribution: 23.33,
    });
    expect(component(result, 'critical-component-exposure')).toMatchObject({
      rawInput: 0.75,
      normalizedValue: 0.75,
      weight: 0.25,
      contribution: 18.75,
    });
    expect(component(result, 'domain-reach')).toMatchObject({
      rawInput: 2,
      normalizedValue: 2 / 3,
      weight: 0.15,
      contribution: 10,
    });
    expect(component(result, 'risk-exposure')).toMatchObject({
      rawInput: 7,
      normalizedValue: 0.7,
      weight: 0.15,
      contribution: 10.5,
    });
    expect(component(result, 'architecture-boundaries')).toMatchObject({
      rawInput: 1,
      normalizedValue: 0.5,
      weight: 0.1,
      contribution: 5,
    });
    expect(result.score.total).toBe(67.58);
    expect(result.score.components.reduce((total, item) => total + item.contribution, 0)).toBe(
      result.score.total,
    );
    for (const scoreComponent of result.score.components) {
      expect(
        scoreComponent.evidenceIds.every((id) => result.evidence.some((item) => item.id === id)),
      ).toBe(true);
    }
  });

  it('uses distinct domains, canonical risks, and unique layer crossings', () => {
    const semantic = semanticFixture();
    const enrichedSemantic: ImpactSemanticInput = {
      ...semantic,
      domains: [...semantic.domains!, { ...semantic.domains![0]!, entityIds: ['file:B.ts'] }],
      risks: [
        ...semantic.risks!,
        risk('risk:medium:A', 'medium', ['A.ts']),
        risk('risk:low:C', 'low', ['C.ts']),
      ],
    };
    const result = score(chainGraph(), enrichedSemantic, 'C.ts');

    expect(new Set(result.semanticEffects.domains.map((item) => item.id)).size).toBe(
      result.semanticEffects.domains.length,
    );
    expect(result.semanticEffects.domains).toHaveLength(2);
    expect(component(result, 'risk-exposure').rawInput).toBe(13);
    expect(result.semanticEffects.architecture.boundaryCrossings).toHaveLength(1);

    const duplicateDomain = { ...semantic.domains![0]!, entityIds: ['file:B.ts'] };
    const reordered = score(
      chainGraph(),
      {
        ...enrichedSemantic,
        domains: [duplicateDomain, semantic.domains![1]!, semantic.domains![0]!],
      },
      'C.ts',
    );
    expect(reordered.semanticEffects).toEqual(result.semanticEffects);
    expect(reordered.score).toEqual(result.score);
    expect(reordered.evidence).toEqual(result.evidence);
  });

  it('marks missing inputs unavailable and bounded observations partial', () => {
    const missing = score(chainGraph(), undefined, 'C.ts');
    expect(component(missing, 'dependency-reach').status).toBe('available');
    for (const kind of [
      'critical-component-exposure',
      'domain-reach',
      'risk-exposure',
      'architecture-boundaries',
    ] as const) {
      expect(component(missing, kind)).toMatchObject({
        rawInput: 0,
        normalizedValue: 0,
        contribution: 0,
        status: 'unavailable',
      });
    }
    expect(missing.warnings.some((warning) => warning.includes('unavailable'))).toBe(true);

    const missingArchitectureEntities = score(
      chainGraph(),
      { architecture: architecture([]) },
      'C.ts',
    );
    expect(component(missingArchitectureEntities, 'architecture-boundaries').status).toBe(
      'partial',
    );

    const truncated = score(chainGraph(), semanticFixture(), 'C.ts', { maxEntities: 1 });
    expect(component(truncated, 'dependency-reach').status).toBe('partial');
    expect(component(truncated, 'domain-reach').status).toBe('partial');
    expect(truncated.complete).toBe(false);
    expect(truncated.truncations).toEqual(
      expect.arrayContaining([{ kind: 'max-entities', limit: 1, atEntityId: 'file:A.ts' }]),
    );
  });

  it('is stable across graph order, semantic permutations, persistence roundtrip, and serialization', () => {
    const firstGraph = chainGraph(['C.ts', 'B.ts', 'A.ts']);
    const secondGraph = chainGraph(['A.ts', 'B.ts', 'C.ts']);
    const firstSemantic = semanticFixture();
    const secondSemantic = reverseSemantic(firstSemantic);
    const first = score(firstGraph, firstSemantic, 'C.ts');
    const second = score(secondGraph, secondSemantic, 'C.ts');
    expect(second.score).toEqual(first.score);

    const restoredGraph = RepositoryGraph.fromJSON(firstGraph.toJSON() as Record<string, unknown>);
    const restoredSemantic = JSON.parse(JSON.stringify(firstSemantic)) as ImpactSemanticInput;
    const restored = score(restoredGraph, restoredSemantic, 'C.ts');
    expect(restored).toEqual(first);
    expect(JSON.stringify(restored.score)).toBe(JSON.stringify(first.score));
  });

  it('never double-counts criticality factors and always remains bounded', () => {
    const baseline = score(chainGraph(), semanticFixture(), 'C.ts');
    const baseSemantic = semanticFixture();
    const semantic: ImpactSemanticInput = {
      ...baseSemantic,
      criticalComponents: baseSemantic.criticalComponents!.map((item) => ({
        ...item,
        factors: { centrality: 1, fanIn: 1, fanOut: 1, complexity: 1, size: 1 },
      })),
    };
    const changedFactors = score(chainGraph(), semantic, 'C.ts');
    expect(changedFactors.score).toEqual(baseline.score);

    for (let count = 0; count <= 50; count++) {
      const ids = Array.from({ length: count }, (_, index) => `D${index}.ts`);
      const result = score(
        graph(
          [...ids, 'target.ts'],
          ids.map((id) => [id, 'target.ts'] as const),
        ),
        emptySemantic(),
        'target.ts',
      );
      expect(result.score.total).toBeGreaterThanOrEqual(0);
      expect(result.score.total).toBeLessThanOrEqual(100);
      expect(result.score.components.reduce((total, item) => total + item.contribution, 0)).toBe(
        result.score.total,
      );
    }
  });

  it('rejects stale versions and cancellation before scoring', () => {
    const graphValue = chainGraph();
    const stale = engine.getImpact(
      {
        repositoryId: 'repo:score',
        analysisVersion: 2,
        expectedAnalysisVersion: 3,
        graph: graphValue,
        semantic: semanticFixture(),
      },
      { kind: 'file', path: 'C.ts' },
    );
    expect(stale).toMatchObject({
      ok: false,
      error: { message: 'Stale impact analysis version: expected 3, received 2' },
    });

    const controller = new AbortController();
    controller.abort();
    const cancelled = engine.getImpact(
      { repositoryId: 'repo:score', analysisVersion: 1, graph: graphValue },
      { kind: 'file', path: 'C.ts' },
      {},
      controller.signal,
    );
    expect(cancelled).toMatchObject({ ok: false, error: { message: 'Impact analysis cancelled' } });
  });
});

function score(
  graphValue: RepositoryGraph,
  semantic: ImpactSemanticInput | undefined,
  targetPath: string,
  options: Parameters<ImpactEngine['getImpact']>[2] = {},
): ImpactResult {
  const result = engine.getImpact(
    { repositoryId: 'repo:score', analysisVersion: 1, graph: graphValue, semantic },
    { kind: 'file', path: targetPath },
    { maxEvidencePaths: 3, ...options },
  );
  if (isErr(result)) throw result.error;
  return result.value;
}

function component(
  result: ImpactResult,
  kind: ImpactResult['score']['components'][number]['kind'],
) {
  const found = result.score.components.find((item) => item.kind === kind);
  if (!found) throw new Error(`Missing score component ${kind}`);
  return found;
}

function graph(
  ids: readonly string[],
  edges: readonly (readonly [string, string])[] = [],
): RepositoryGraph {
  const result = new RepositoryGraph();
  for (const id of ids) result.addFileNode(id, { label: id, path: id });
  for (const [dependent, dependency] of edges) {
    result.addDependency(dependent, dependency, {
      type: 'import',
      isTypeOnly: false,
      specifierCount: 1,
      isExternal: false,
    });
  }
  return result;
}

function chainGraph(order: readonly string[] = ['C.ts', 'B.ts', 'A.ts']): RepositoryGraph {
  return graph(order, [
    ['A.ts', 'B.ts'],
    ['B.ts', 'C.ts'],
  ]);
}

function emptySemantic(): ImpactSemanticInput {
  return {
    entities: [],
    domains: [],
    capabilities: [],
    criticalComponents: [],
    risks: [],
    architecture: architecture([]),
  };
}

function semanticFixture(): ImpactSemanticInput {
  return {
    entities: [
      entity('A.ts', 'application'),
      entity('B.ts', 'application'),
      entity('C.ts', 'presentation'),
    ],
    domains: [
      domain('domain:ui', ['file:C.ts']),
      domain('domain:core', ['file:A.ts', 'file:B.ts']),
    ],
    capabilities: [capability('capability:web', ['file:C.ts'])],
    criticalComponents: [critical('critical:B', 'file:B.ts', 0.75)],
    risks: [
      risk('risk:high:B', 'high', ['B.ts']),
      risk('risk:outside', 'critical', ['outside.ts']),
    ],
    architecture: architecture([
      { name: 'presentation', directories: ['src/ui'], fileCount: 1, role: 'presentation' },
      { name: 'application', directories: ['src/app'], fileCount: 2, role: 'application' },
    ]),
  };
}

function reverseSemantic(value: ImpactSemanticInput): ImpactSemanticInput {
  return {
    entities: [...(value.entities ?? [])].reverse(),
    domains: [...(value.domains ?? [])].reverse(),
    capabilities: [...(value.capabilities ?? [])].reverse(),
    criticalComponents: [...(value.criticalComponents ?? [])].reverse(),
    risks: [...(value.risks ?? [])].reverse(),
    architecture: value.architecture
      ? { ...value.architecture, layers: [...value.architecture.layers].reverse() }
      : value.architecture,
  };
}

function entity(path: string, layer: string): DNAObject {
  return {
    id: `file:${path}`,
    kind: 'file',
    name: path,
    path,
    purpose: 'fixture',
    architectureRole: 'service',
    businessDomain: null,
    importance: 0.5,
    criticality: 'medium',
    complexity: 1,
    healthScore: 0.8,
    risks: [],
    dependsOn: [],
    dependedOnBy: [],
    belongsToDomain: null,
    belongsToLayer: layer,
    knowledgeNodeIds: [],
    knowledgeDensity: 0,
    confidence: 0.7,
    lastAnalyzedAt: 1,
  };
}

function domain(id: string, entityIds: string[]): BusinessDomain {
  return {
    id,
    name: id,
    inferenceSource: 'composite',
    confidence: 0.8,
    rootPaths: [],
    entityIds,
    fileCount: entityIds.length,
    linesOfCode: entityIds.length,
    primaryLanguages: ['typescript'],
    dependsOn: [],
    dependedOnBy: [],
    detectedAt: 1,
  };
}

function capability(id: string, implementedBy: string[]): Capability {
  return {
    id,
    name: id,
    category: 'other',
    description: 'fixture',
    confidence: 0.9,
    evidence: [],
    implementedBy,
    detectedAt: 1,
  };
}

function critical(id: string, entityId: string, scoreValue: number): CriticalComponent {
  return {
    id,
    entityId,
    name: id,
    path: entityId.slice('file:'.length),
    criticality: 'high',
    score: scoreValue,
    factors: { centrality: 0.5, fanIn: 0.5, fanOut: 0.5, complexity: 0.5, size: 0.5 },
    reason: 'fixture',
    associatedRiskIds: [],
    identifiedAt: 1,
  };
}

function risk(id: string, severity: RiskNode['severity'], affectedEntities: string[]): RiskNode {
  return {
    id,
    type: 'high-complexity',
    severity,
    affectedEntities,
    description: 'fixture',
    detectedAt: 1,
  };
}

function architecture(layers: ArchitectureDNA['layers']): ArchitectureDNA {
  return {
    id: 'architecture:fixture',
    pattern: 'layered',
    confidence: 0.85,
    detectedPatterns: [{ pattern: 'layered', confidence: 0.85 }],
    layers,
    evidence: [],
    detectedAt: 1,
  };
}
