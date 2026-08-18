import { describe, expect, it } from 'vitest';
import { isErr } from '@project-dna/shared';
import {
  createAnalysisStateView,
  RepositoryGraph,
  type ArchitectureDNA,
  type BusinessDomain,
  type Capability,
  type CriticalComponent,
  type DNAObject,
  type RiskNode,
} from '@project-dna/dna-core';
import { ImpactEngine } from '../index.js';

const engine = new ImpactEngine();

describe('ImpactEngine semantic enrichment', () => {
  it('enriches risks, domains, capabilities, critical components, and layers from canonical models', () => {
    const result = calculate({ semantic: semanticFixture() });

    expect(result.semanticEffects.domains.map((domain) => domain.id)).toEqual([
      'domain:core',
      'domain:ui',
    ]);
    expect(result.semanticEffects.capabilities.map((capability) => capability.id)).toEqual([
      'capability:storage',
      'capability:web',
    ]);
    expect(result.semanticEffects.criticalComponents.map((component) => component.id)).toEqual([
      'critical:file:B.ts',
    ]);
    expect(result.semanticEffects.risks.map((risk) => risk.id)).toEqual(['risk:complexity:B.ts']);
    expect(result.semanticEffects.architecture.layers.map((layer) => layer.name)).toEqual([
      'application',
      'presentation',
    ]);
    expect(result.semanticEffects.architecture.boundaryCrossings).toEqual([
      {
        fromLayer: 'presentation',
        toLayer: 'application',
        dependencyId: 'file:C.ts',
        dependentId: 'file:B.ts',
      },
    ]);
    expect(result.evidence.map((item) => item.reason)).toEqual(
      expect.arrayContaining([
        'domain-membership',
        'capability-implementation',
        'critical-component',
        'risk-reference',
        'architecture-layer-membership',
        'layer-boundary',
      ]),
    );
  });

  it('is deterministic across semantic and graph insertion order', () => {
    const first = calculate({ semantic: semanticFixture() });
    const second = calculate({
      semantic: reverseSemanticFixture(),
      graphOrder: ['A.ts', 'B.ts', 'C.ts'],
    });
    expect(second.semanticEffects).toEqual(first.semanticEffects);
    expect(second.evidence).toEqual(first.evidence);
  });

  it('bounds semantic collections and reports explicit truncation warnings', () => {
    const semantic = semanticFixture();
    const result = calculate({
      semantic: {
        ...semantic,
        domains: [
          ...semantic.domains!,
          { ...semantic.domains![0]!, id: 'domain:extra', name: 'Extra' },
        ],
      },
      options: { maxEntities: 1, maxEvidencePaths: 2 },
    });

    expect(result.semanticEffects.domains).toHaveLength(1);
    expect(result.warnings).toContain('Semantic enrichment truncated domains to 1');
  });

  it('reports missing semantic collections instead of guessing', () => {
    const result = calculate({ semantic: { domains: [], risks: [] } });

    expect(result.semanticEffects.domains).toEqual([]);
    expect(result.semanticEffects.risks).toEqual([]);
    expect(result.semanticEffects.capabilities).toEqual([]);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        'Semantic enrichment incomplete: capabilities unavailable',
        'Semantic enrichment incomplete: critical components unavailable',
        'Semantic enrichment incomplete: architecture layers unavailable',
      ]),
    );
  });
});

function calculate(input: {
  readonly semantic?: ReturnType<typeof semanticFixture> | Partial<ReturnType<typeof semanticFixture>>;
  readonly graphOrder?: readonly string[];
  readonly options?: Parameters<ImpactEngine['getImpact']>[2];
}) {
  const graph = new RepositoryGraph();
  for (const id of input.graphOrder ?? ['C.ts', 'B.ts', 'A.ts']) {
    graph.addFileNode(id, { label: id, path: id });
  }
  graph.addDependency('A.ts', 'B.ts', edge());
  graph.addDependency('B.ts', 'C.ts', edge());
  const result = engine.getImpact(
    {
      repositoryId: 'repo:semantic',
      analysisVersion: 1,
      state: createAnalysisStateView({
        repositoryId: 'repo:semantic',
        analysisVersion: 1,
        entities: input.semantic?.entities ?? [],
        graph,
        domains: input.semantic?.domains,
        capabilities: input.semantic?.capabilities,
        criticalComponents: input.semantic?.criticalComponents,
        risks: input.semantic?.risks,
        architecture: input.semantic?.architecture,
      }),
    },
    { kind: 'entity', id: 'file:C.ts' },
    { maxEvidencePaths: 3, ...input.options },
  );
  if (isErr(result)) throw result.error;
  return result.value;
}

function semanticFixture() {
  return {
    entities: [
      entity('file:A.ts', 'application'),
      entity('file:B.ts', 'application'),
      entity('file:C.ts', 'presentation'),
    ],
    domains: [
      domain('domain:ui', ['file:C.ts']),
      domain('domain:core', ['file:A.ts', 'file:B.ts']),
    ],
    capabilities: [
      capability('capability:web', ['file:C.ts']),
      capability('capability:storage', ['file:B.ts']),
    ],
    criticalComponents: [critical('critical:file:B.ts', 'file:B.ts')],
    risks: [risk('risk:complexity:B.ts', 'B.ts'), risk('risk:unrelated', 'unrelated.ts')],
    architecture: architecture(),
  };
}

function reverseSemanticFixture() {
  const semantic = semanticFixture();
  return {
    ...semantic,
    entities: [...semantic.entities].reverse(),
    domains: [...semantic.domains].reverse(),
    capabilities: [...semantic.capabilities].reverse(),
    criticalComponents: [...semantic.criticalComponents].reverse(),
    risks: [...semantic.risks].reverse(),
  };
}

function entity(id: string, layer: string): DNAObject {
  return {
    id,
    kind: 'file',
    name: id,
    path: id.slice('file:'.length),
    purpose: 'fixture',
    architectureRole: 'service',
    businessDomain: null,
    importance: 0.5,
    criticality: 'medium',
    complexity: 1,
    healthScore: 0.8,
    risks: id === 'file:B.ts' ? ['risk:complexity:B.ts'] : [],
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
    name: id.slice('domain:'.length),
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
    name: id.slice('capability:'.length),
    category: 'other',
    description: 'fixture',
    confidence: 0.9,
    evidence: [],
    implementedBy,
    detectedAt: 1,
  };
}

function critical(id: string, entityId: string): CriticalComponent {
  return {
    id,
    entityId,
    name: entityId,
    path: entityId.slice('file:'.length),
    criticality: 'high',
    score: 0.75,
    factors: { centrality: 0.5, fanIn: 0.5, fanOut: 0.5, complexity: 0.5, size: 0.5 },
    reason: 'fixture',
    associatedRiskIds: ['risk:complexity:B.ts'],
    identifiedAt: 1,
  };
}

function risk(id: string, path: string): RiskNode {
  return {
    id,
    type: 'high-complexity',
    severity: 'high',
    affectedEntities: [path],
    description: 'fixture',
    measuredValue: 30,
    threshold: 20,
    suggestion: 'fixture',
    detectedAt: 1,
  };
}

function architecture(): ArchitectureDNA {
  return {
    id: 'architecture:fixture',
    pattern: 'layered',
    confidence: 0.85,
    detectedPatterns: [{ pattern: 'layered', confidence: 0.85 }],
    layers: [
      { name: 'presentation', directories: ['src/ui'], fileCount: 1, role: 'presentation' },
      { name: 'application', directories: ['src/app'], fileCount: 2, role: 'application' },
      { name: 'unused', directories: [], fileCount: 0, role: 'unknown' },
    ],
    evidence: [],
    detectedAt: 1,
  };
}

function edge() {
  return { type: 'import' as const, isTypeOnly: false, specifierCount: 1, isExternal: false };
}
