import { isErr } from '@project-dna/shared';
import {
  createAnalysisStateView,
  RepositoryGraph,
  type AnalysisStateView,
  type ArchitectureDNA,
  type BusinessDomain,
  type Capability,
  type CriticalComponent,
  type DNAObject,
  type GraphEdgeAttributes,
  type ImpactOptions,
  type ImpactResult,
  type ImpactTarget,
  type RiskNode,
} from '@project-dna/dna-core';
import { ImpactEngine, type ImpactSemanticInput } from '../../index.js';

export interface ImpactFixtureEdge {
  readonly dependent: string;
  readonly dependency: string;
  readonly attributes?: Partial<GraphEdgeAttributes>;
}

export interface ImpactFixtureInput {
  readonly id: string;
  readonly nodes: readonly string[];
  readonly edges: readonly ImpactFixtureEdge[];
  readonly target: ImpactTarget;
  readonly options?: Partial<ImpactOptions>;
  readonly semantic?: ImpactSemanticInput;
  readonly analysisVersion?: number;
  readonly restoreState?: boolean;
}

const engine = new ImpactEngine();

export function calculateFixture(input: ImpactFixtureInput): ImpactResult {
  const state = createFixtureState(input);
  const restored = input.restoreState
    ? (JSON.parse(JSON.stringify(state)) as AnalysisStateView)
    : state;
  const result = engine.getImpact(
    {
      repositoryId: `repo:${input.id}`,
      analysisVersion: input.analysisVersion ?? 1,
      state: restored,
    },
    input.target,
    { maxEvidencePaths: 3, ...input.options },
  );
  if (isErr(result)) throw result.error;
  return result.value;
}

export function createFixtureState(input: ImpactFixtureInput): AnalysisStateView {
  const graph = new RepositoryGraph();
  for (const node of input.nodes) {
    graph.addFileNode(node, { label: node, path: node, language: 'typescript' });
  }
  for (const edge of input.edges) {
    graph.addDependency(edge.dependent, edge.dependency, {
      type: 'import',
      isTypeOnly: false,
      specifierCount: 1,
      isExternal: false,
      ...edge.attributes,
    });
  }
  return createAnalysisStateView({
    repositoryId: `repo:${input.id}`,
    analysisVersion: input.analysisVersion ?? 1,
    entities: input.semantic?.entities ?? input.nodes.map((node) => entity(node)),
    graph,
    domains: input.semantic?.domains,
    capabilities: input.semantic?.capabilities,
    criticalComponents: input.semantic?.criticalComponents,
    risks: input.semantic?.risks,
    architecture: input.semantic?.architecture,
  });
}

export function emptySemantic(nodes: readonly string[]): ImpactSemanticInput {
  return {
    entities: nodes.map((node) => entity(node)),
    domains: [],
    capabilities: [],
    criticalComponents: [],
    risks: [],
    architecture: architecture([]),
  };
}

export function entity(path: string, layer: string | null = null): DNAObject {
  return {
    id: `file:${path}`,
    kind: 'file',
    name: path,
    path,
    purpose: 'impact fixture',
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
    confidence: 0.8,
    lastAnalyzedAt: 1,
  };
}

export function domain(id: string, entityIds: readonly string[]): BusinessDomain {
  return {
    id,
    name: id.slice('domain:'.length),
    inferenceSource: 'composite',
    confidence: 0.8,
    rootPaths: [],
    entityIds: [...entityIds],
    fileCount: entityIds.length,
    linesOfCode: entityIds.length,
    primaryLanguages: ['typescript'],
    dependsOn: [],
    dependedOnBy: [],
    detectedAt: 1,
  };
}

export function capability(id: string, implementedBy: readonly string[]): Capability {
  return {
    id,
    name: id.slice('capability:'.length),
    category: 'other',
    description: 'impact fixture',
    confidence: 0.9,
    evidence: [],
    implementedBy: [...implementedBy],
    detectedAt: 1,
  };
}

export function critical(id: string, entityId: string, score: number): CriticalComponent {
  return {
    id,
    entityId,
    name: id,
    path: entityId.slice('file:'.length),
    criticality: 'high',
    score,
    factors: { centrality: 0.5, fanIn: 0.5, fanOut: 0.5, complexity: 0.5, size: 0.5 },
    reason: 'impact fixture',
    associatedRiskIds: [],
    identifiedAt: 1,
  };
}

export function risk(
  id: string,
  severity: RiskNode['severity'],
  affectedEntities: readonly string[],
): RiskNode {
  return {
    id,
    type: 'high-complexity',
    severity,
    affectedEntities: [...affectedEntities],
    description: 'impact fixture',
    measuredValue: 30,
    threshold: 20,
    suggestion: 'reduce complexity',
    detectedAt: 1,
  };
}

export function architecture(layers: ArchitectureDNA['layers']): ArchitectureDNA {
  return {
    id: 'architecture:impact-fixture',
    pattern: 'layered',
    confidence: 0.85,
    detectedPatterns: [{ pattern: 'layered', confidence: 0.85 }],
    layers,
    evidence: [],
    detectedAt: 1,
  };
}
