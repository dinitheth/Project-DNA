import { describe, expect, it } from 'vitest';
import {
  createAnalysisChangeSet,
  createAnalysisStateView,
  RepositoryGraph,
  serializeAnalysisChangeSet,
  type AnalysisStateView,
  type DNAObject,
  type RiskNode,
} from '../index.js';

describe('AnalysisChangeSet', () => {
  it('detects entity, relationship, risk, and membership changes', () => {
    const from = state({ entityIds: ['A.ts', 'B.ts'], edge: true, risk: 'high' });
    const to = state({ entityIds: ['A.ts', 'C.ts'], edge: false, risk: 'critical', moveA: true });
    const changes = createAnalysisChangeSet(from, to);

    expect(changes.addedEntityIds).toEqual(['file:C.ts']);
    expect(changes.removedEntityIds).toEqual(['file:B.ts']);
    expect(changes.modifiedEntities[0]).toMatchObject({
      id: 'file:A.ts',
      changes: expect.arrayContaining([
        { field: 'belongsToDomain', from: 'domain:old', to: 'domain:new' },
        { field: 'belongsToLayer', from: 'layer:old', to: 'layer:new' },
      ]),
    });
    expect(changes.addedRelationships).toHaveLength(0);
    expect(changes.removedRelationships).toHaveLength(1);
    expect(changes.addedRiskIds).toEqual([]);
    expect(changes.resolvedRiskIds).toEqual([]);
    expect(changes.modifiedRisks).toMatchObject([
      { id: 'risk:A', changes: [{ field: 'severity', from: 'high', to: 'critical' }] },
    ]);
    expect(changes.domainMembershipChanges).toEqual([
      { entityId: 'file:A.ts', from: 'domain:old', to: 'domain:new' },
    ]);
    expect(changes.architectureMembershipChanges).toEqual([
      { entityId: 'file:A.ts', from: 'layer:old', to: 'layer:new' },
    ]);
  });

  it('detects added and resolved risks and domain changes', () => {
    const from = state({ entityIds: ['A.ts'], risk: 'none', domains: ['domain:old'] });
    const to = state({ entityIds: ['A.ts'], risk: 'new', domains: ['domain:new'], moveA: true });
    const changes = createAnalysisChangeSet(from, to);

    expect(changes.addedRiskIds).toEqual(['risk:new']);
    expect(changes.resolvedRiskIds).toEqual([]);
    expect(changes.addedDomainIds).toEqual(['domain:new']);
    expect(changes.removedDomainIds).toEqual(['domain:old']);

    const resolved = createAnalysisChangeSet(to, state({ entityIds: ['A.ts'], risk: 'none' }));
    expect(resolved.resolvedRiskIds).toEqual(['risk:new']);
  });

  it('detects dependency additions as canonical relationships', () => {
    const withoutDependency = state({ entityIds: ['A.ts', 'B.ts'] });
    const withDependency = state({ entityIds: ['A.ts', 'B.ts'], edge: true });
    const changes = createAnalysisChangeSet(withoutDependency, withDependency);

    expect(changes.addedRelationships).toMatchObject([
      { sourceId: 'A.ts', targetId: 'B.ts', attributes: { type: 'import' } },
    ]);
    expect(changes.removedRelationships).toEqual([]);
  });

  it('is empty, stable, and persistence-order independent for equivalent states', () => {
    const first = state({ entityIds: ['A.ts', 'B.ts'], edge: true });
    const second = state({ entityIds: ['B.ts', 'A.ts'], edge: true, reverse: true });
    const changes = createAnalysisChangeSet(first, second);

    expect(changes.addedEntityIds).toEqual([]);
    expect(changes.removedEntityIds).toEqual([]);
    expect(changes.modifiedEntities).toEqual([]);
    expect(changes.addedRelationships).toEqual([]);
    expect(changes.removedRelationships).toEqual([]);
    expect(changes.modifiedRisks).toEqual([]);
    expect(serializeAnalysisChangeSet(changes)).toBe(
      serializeAnalysisChangeSet(createAnalysisChangeSet(second, first)),
    );
    const restored = JSON.parse(JSON.stringify(first)) as AnalysisStateView;
    expect(createAnalysisChangeSet(first, restored)).toEqual(changes);
  });

  it('records unavailable semantic collections explicitly', () => {
    const from = state({ entityIds: ['A.ts'], risk: 'none' });
    const to = createAnalysisStateView({
      ...stateInput(['A.ts']),
      risks: null,
      architecture: null,
    });
    expect(createAnalysisChangeSet(from, to).unavailableCollections).toEqual([
      'domains',
      'risks',
      'architecture',
    ]);
  });
});

function state(options: {
  entityIds: string[];
  edge?: boolean;
  risk?: 'none' | 'new' | 'high' | 'critical';
  domains?: string[];
  reverse?: boolean;
  moveA?: boolean;
}): AnalysisStateView {
  const input = stateInput(options.entityIds);
  const graph = input.graph;
  if (options.edge) {
    graph.addDependency('A.ts', 'B.ts', {
      type: 'import',
      isTypeOnly: false,
      specifierCount: 1,
      isExternal: false,
    });
  }
  const entities = input.entities.map((entity) =>
    entity.id === 'file:A.ts' && options.moveA
      ? { ...entity, belongsToDomain: 'domain:new', belongsToLayer: 'layer:new' }
      : entity,
  );
  const risks =
    options.risk === undefined || options.risk === 'none'
      ? []
      : [
          risk(
            options.risk === 'new' ? 'risk:new' : 'risk:A',
            options.risk === 'new' ? 'high' : options.risk,
          ),
        ];
  const domains = (options.domains ?? ['domain:old']).map((id) => ({
    id,
    name: id,
    inferenceSource: 'folder-structure' as const,
    confidence: 0.8,
    rootPaths: [],
    entityIds: ['file:A.ts'],
    fileCount: 1,
    linesOfCode: 1,
    primaryLanguages: ['typescript'],
    dependsOn: [],
    dependedOnBy: [],
    detectedAt: 1,
  }));
  return createAnalysisStateView({
    ...input,
    entities: options.reverse ? [...entities].reverse() : entities,
    graph,
    domains,
    risks,
  });
}

function stateInput(entityIds: string[]): {
  entities: DNAObject[];
  graph: RepositoryGraph;
  repositoryId: string;
  analysisVersion: number;
} {
  const graph = new RepositoryGraph();
  for (const id of entityIds) graph.addFileNode(id, { label: id, path: id });
  return {
    repositoryId: 'repo:changes',
    analysisVersion: 2,
    entities: entityIds.map((path) => ({
      id: `file:${path}`,
      kind: 'file',
      name: path,
      path,
      purpose: 'fixture',
      architectureRole: 'unknown',
      businessDomain: null,
      importance: 0.5,
      criticality: 'medium',
      complexity: 1,
      healthScore: 1,
      risks: [],
      dependsOn: [],
      dependedOnBy: [],
      belongsToDomain: 'domain:old',
      belongsToLayer: 'layer:old',
      knowledgeNodeIds: [],
      knowledgeDensity: 0,
      confidence: 1,
      lastAnalyzedAt: 1,
    })),
    graph,
  };
}

function risk(id: string, severity: RiskNode['severity']): RiskNode {
  return {
    id,
    type: 'high-complexity',
    severity,
    affectedEntities: ['A.ts'],
    description: 'fixture',
    detectedAt: 1,
  };
}
