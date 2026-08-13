import { describe, expect, it } from 'vitest';
import { ExtensionMessageSchema } from '@project-dna/shared';
import {
  initialEntityDetailState,
  reduceEntityDetailState,
  restoreEntityDetailState,
} from './entity-detail-state.js';

describe('entity detail state', () => {
  it('keeps the latest rapid selection when responses arrive in reverse order', () => {
    const selectedA = select(initialEntityDetailState, 'entity-a', 3);
    const selectedB = select(selectedA, 'entity-b', 3);
    const resolvedB = receive(selectedB, detail(selectedB, 'entity-b'));
    const lateA = receive(resolvedB, detail(selectedA, 'entity-a'));

    expect(lateA.status).toBe('ready');
    expect(lateA.entityId).toBe('entity-b');
    expect(lateA.entity?.name).toBe('entity-b');
  });

  it('rejects stale analysis versions and clears detail on refresh', () => {
    const selected = select(initialEntityDetailState, 'entity-a', 3);
    expect(receive(selected, detail(selected, 'entity-a', 2))).toBe(selected);
    const refreshed = receive(
      selected,
      ExtensionMessageSchema.parse({
        type: 'analysisSnapshot',
        version: 4,
        data: snapshotData(4),
      }),
    );
    expect(refreshed).toEqual({ ...initialEntityDetailState, requestId: selected.requestId });
  });

  it('reports missing entities without accepting malformed correlation', () => {
    const selected = select(initialEntityDetailState, 'missing', 1);
    const missing = receive(
      selected,
      ExtensionMessageSchema.parse({
        type: 'entityDetail',
        requestId: selected.requestId,
        analysisVersion: 1,
        entityId: 'missing',
        entity: null,
        error: 'Entity not found.',
      }),
    );
    expect(missing.status).toBe('error');
    expect(missing.error).toBe('Entity not found.');
  });

  it('restores a pending request for webview recreation without restarting request IDs', () => {
    const selected = select(initialEntityDetailState, 'entity-a', 3);
    const restored = restoreEntityDetailState({ entityDetail: selected });

    expect(restored).toEqual(selected);
    expect(select(restored, 'entity-b', 3).requestId).toBe(selected.requestId + 1);
  });

  it('rejects malformed persisted entity details', () => {
    expect(
      restoreEntityDetailState({
        entityDetail: { ...initialEntityDetailState, status: 'ready', entity: { id: 1 } },
      }),
    ).toEqual(initialEntityDetailState);
  });
});

function select(state: typeof initialEntityDetailState, entityId: string, analysisVersion: number) {
  const requestId = state.requestId === Number.MAX_SAFE_INTEGER ? 0 : state.requestId + 1;
  return reduceEntityDetailState(state, { type: 'select', requestId, entityId, analysisVersion });
}

function receive(
  state: ReturnType<typeof select>,
  message: ReturnType<typeof ExtensionMessageSchema.parse>,
) {
  return reduceEntityDetailState(state, { type: 'message', message });
}

function detail(state: ReturnType<typeof select>, entityId: string, analysisVersion = 3) {
  return ExtensionMessageSchema.parse({
    type: 'entityDetail',
    requestId: state.requestId,
    analysisVersion,
    entityId,
    entity: {
      id: entityId,
      name: entityId,
      kind: 'file',
      path: `src/${entityId}.ts`,
      purpose: 'Fixture',
      role: 'service',
      domain: null,
      criticality: 'medium',
      complexity: 1,
      health: 0.9,
      dependencies: [],
      dependents: [],
      risks: [],
      knowledgeReferences: [],
    },
  });
}

function snapshotData(version: number) {
  return {
    repository: {
      name: 'fixture',
      description: '',
      rootPath: 'C:/repo',
      version,
      analyzedAt: 1,
      durationMs: 1,
      projectType: 'library',
      repositorySize: 'small',
      packageManager: null,
      testFramework: null,
      ciSystem: null,
      languages: [],
      frameworks: [],
      counts: { modules: 0, entities: 0, domains: 0, capabilities: 0, knowledgeNodes: 0, risks: 0 },
      coverage: { scanned: 0, parsed: 0, skipped: 0, failed: 0 },
      health: {
        overallScore: 0,
        trend: 'unknown',
        dimensions: {
          architectureHealth: 0,
          dependencyHealth: 0,
          complexityHealth: 0,
          knowledgeHealth: 0,
          riskHealth: 0,
        },
      },
      complexity: {
        averageComplexity: 0,
        maxComplexity: 0,
        mostComplexFile: null,
        complexCodePercentage: 0,
        averageNestingDepth: 0,
        maxNestingDepth: 0,
      },
      risks: {
        overallRiskScore: 0,
        totalRisks: 0,
        bySeverity: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
        topRisks: [],
      },
      criticalComponents: [],
      story: { summary: '', healthSummary: '', criticalPath: '', risks: [] },
    },
    architecture: {
      pattern: 'unknown',
      confidence: 0,
      detectedAt: 1,
      detectedPatterns: [],
      layers: [],
      evidence: [],
      summary: '',
    },
    dependencies: {
      nodeCount: 0,
      edgeCount: 0,
      nodeKinds: { files: 0, modules: 0, packages: 0, external: 0 },
      edgeTypes: { imports: 0, reExports: 0, dynamicImports: 0, requires: 0, typeImports: 0 },
      hotspots: [],
    },
    knowledge: { domains: [], capabilities: [], nodes: [] },
    semanticGraph: { nodeCount: 0, edgeCount: 0, nodes: [], edges: [], truncated: false },
    evolution: { latestSnapshot: null, history: [] },
  };
}
