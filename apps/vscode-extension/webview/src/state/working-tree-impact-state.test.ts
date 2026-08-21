import { describe, expect, it } from 'vitest';
import { ExtensionMessageSchema } from '@project-dna/shared';
import {
  initialWorkingTreeImpactState,
  reduceWorkingTreeImpactState,
  restoreWorkingTreeImpactState,
  shouldFocusWorkingTreeStatus,
} from './working-tree-impact-state.js';

describe('working-tree impact state', () => {
  it('accepts only the newest correlated request and analysis version', () => {
    const first = request(1, 3);
    const second = reduceWorkingTreeImpactState(first, {
      type: 'request',
      requestId: 2,
      analysisVersion: 3,
    });
    expect(reduceWorkingTreeImpactState(second, { type: 'message', message: result(1, 3) })).toBe(
      second,
    );
    expect(reduceWorkingTreeImpactState(second, { type: 'message', message: result(2, 4) })).toBe(
      second,
    );
    expect(
      reduceWorkingTreeImpactState(second, { type: 'message', message: result(2, 3) }).status,
    ).toBe('ready');
  });

  it('cancels locally and suppresses a late result', () => {
    const selected = request(1, 3);
    const cancelled = reduceWorkingTreeImpactState(selected, { type: 'cancel', requestId: 1 });
    expect(cancelled.status).toBe('cancelled');
    expect(
      reduceWorkingTreeImpactState(cancelled, { type: 'message', message: result(1, 3) }),
    ).toBe(cancelled);
  });

  it('clears an active or restored result when analysis refreshes', () => {
    const selected = request(7, 3);
    const refreshed = reduceWorkingTreeImpactState(selected, {
      type: 'message',
      message: ExtensionMessageSchema.parse({
        type: 'analysisSnapshot',
        version: 4,
        data: snapshot(4),
      }),
    });
    expect(refreshed).toEqual({ ...initialWorkingTreeImpactState, requestId: 7 });
  });

  it('clears a visible result when the workspace becomes unavailable', () => {
    const selected = request(7, 3);
    const ready = reduceWorkingTreeImpactState(selected, {
      type: 'message',
      message: result(7, 3),
    });
    const unavailable = reduceWorkingTreeImpactState(ready, {
      type: 'message',
      message: ExtensionMessageSchema.parse({ type: 'analysisUnavailable', rootPath: null }),
    });
    expect(unavailable).toEqual({ ...initialWorkingTreeImpactState, requestId: 7 });
  });

  it('restores pending requests and rejects malformed persisted state', () => {
    const selected = request(3, 5);
    expect(restoreWorkingTreeImpactState({ workingTreeImpact: selected })).toEqual(selected);
    expect(
      restoreWorkingTreeImpactState({
        workingTreeImpact: { ...selected, result: { internalGraph: {} } },
      }),
    ).toEqual(initialWorkingTreeImpactState);
    expect(
      restoreWorkingTreeImpactState({
        workingTreeImpact: { ...selected, error: { invalid: true } },
      }),
    ).toEqual(initialWorkingTreeImpactState);
  });

  it('preserves immutable provenance and semantic changes across recreation', () => {
    const canonicalHeadCommit = 'c'.repeat(40);
    const loading = request(5, 3);
    const ready = reduceWorkingTreeImpactState(loading, {
      type: 'message',
      message: result(5, 3, {
        headCommit: canonicalHeadCommit,
        provenance: {
          headCommit: canonicalHeadCommit,
          gitVersion: '2.51.0',
          changeSetFingerprint: 'c'.repeat(64),
          contentFingerprint: 'd'.repeat(64),
        },
        changeSet: changeSet(),
      }),
    });
    const restored = restoreWorkingTreeImpactState({ workingTreeImpact: ready });
    expect(restored).toEqual(ready);
    expect(restored.result?.provenance.changeSetFingerprint).toBe('c'.repeat(64));
    expect(restored.result?.changeSet?.addedEntityIds).toEqual(['file:new']);
  });

  it('rejects mismatched working-tree provenance identities', () => {
    expect(() =>
      result(5, 3, {
        provenance: {
          headCommit: 'c'.repeat(40),
          gitVersion: '2.51.0',
          changeSetFingerprint: 'c'.repeat(64),
          contentFingerprint: 'd'.repeat(64),
        },
      }),
    ).toThrow(/provenance must match/i);
  });

  it('keeps errors explicit', () => {
    const selected = request(1, 3);
    const errored = reduceWorkingTreeImpactState(selected, {
      type: 'message',
      message: ExtensionMessageSchema.parse({
        type: 'workingTreeImpactResult',
        requestId: 1,
        analysisVersion: 3,
        result: null,
        error: 'Working tree changed during impact calculation.',
      }),
    });
    expect(errored).toMatchObject({
      status: 'error',
      error: 'Working tree changed during impact calculation.',
    });
  });

  it('rejects the removed legacy unresolved reason at the webview boundary', () => {
    const valid = result(1, 3);
    if (valid.type !== 'workingTreeImpactResult' || !valid.result) {
      throw new Error('Expected a valid working-tree result');
    }
    expect(
      ExtensionMessageSchema.safeParse({
        ...valid,
        result: {
          ...valid.result,
          unresolvedPaths: [
            { path: 'src/old.ts', side: 'before', reason: 'legacy-analysis-state-unavailable' },
          ],
        },
      }).success,
    ).toBe(false);
  });

  it('focuses only on meaningful loading transitions', () => {
    expect(shouldFocusWorkingTreeStatus('loading', 'ready')).toBe(true);
    expect(shouldFocusWorkingTreeStatus('loading', 'error')).toBe(true);
    expect(shouldFocusWorkingTreeStatus('loading', 'cancelled')).toBe(true);
    expect(shouldFocusWorkingTreeStatus('ready', 'ready')).toBe(false);
    expect(shouldFocusWorkingTreeStatus('idle', 'loading')).toBe(false);
  });
});

function request(requestId: number, analysisVersion: number) {
  return reduceWorkingTreeImpactState(initialWorkingTreeImpactState, {
    type: 'request',
    requestId,
    analysisVersion,
  });
}

function result(
  requestId: number,
  analysisVersion: number,
  overrides: Record<string, unknown> = {},
) {
  return ExtensionMessageSchema.parse({
    type: 'workingTreeImpactResult',
    requestId,
    analysisVersion,
    result: {
      repositoryId: 'repo',
      headCommit: 'a'.repeat(40),
      changedPaths: [],
      resolvedTargets: [],
      unresolvedPaths: [],
      impacts: [],
      changedEntityIds: [],
      impactedEntityIds: [],
      provenance: {
        headCommit: 'a'.repeat(40),
        gitVersion: '2.50.0',
        changeSetFingerprint: 'a'.repeat(64),
        contentFingerprint: 'b'.repeat(64),
      },
      changeSet: null,
      beforeAnalysisVersion: 2,
      afterAnalysisVersion: 3,
      warnings: [],
      complete: true,
      truncations: [],
      ...overrides,
    },
  });
}

function changeSet() {
  return {
    addedEntityIds: ['file:new'],
    removedEntityIds: [],
    modifiedEntities: [],
    addedRelationships: [],
    removedRelationships: [],
    modifiedRelationships: [],
    addedDomainIds: [],
    removedDomainIds: [],
    modifiedDomains: [],
    addedRiskIds: [],
    resolvedRiskIds: [],
    modifiedRisks: [],
    domainMembershipChanges: [],
    architectureMembershipChanges: [],
    unavailableCollections: [],
  };
}

function snapshot(version: number) {
  return {
    repository: {
      name: 'repo',
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
