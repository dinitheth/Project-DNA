import { describe, expect, it, vi } from 'vitest';
import { createExtensionMessageListener } from './useMessage.js';

describe('extension message listener', () => {
  it('delivers a complete validated intelligence snapshot', () => {
    const handler = vi.fn();
    const listener = createExtensionMessageListener(handler);
    const snapshot = createSnapshot();

    listener({ data: snapshot } as MessageEvent<unknown>);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(snapshot);
  });

  it('rejects malformed snapshots before they reach webview state', () => {
    const handler = vi.fn();
    const listener = createExtensionMessageListener(handler);
    const snapshot = createSnapshot();
    const { semanticGraph: _semanticGraph, ...incompleteData } = snapshot.data;

    listener({ data: { ...snapshot, data: incompleteData } } as MessageEvent<unknown>);
    listener({
      data: { type: 'navigateTo', route: 'knowledge', generation: -1, revision: 0 },
    } as MessageEvent<unknown>);

    expect(handler).not.toHaveBeenCalled();
  });

  it('validates actionable intelligence responses before delivery', () => {
    const handler = vi.fn();
    const listener = createExtensionMessageListener(handler);

    listener({
      data: {
        type: 'entityDetail',
        requestId: 1,
        analysisVersion: 2,
        entityId: 'entity-1',
        entity: null,
        error: 'Entity not found.',
      },
    } as MessageEvent<unknown>);
    listener({
      data: {
        type: 'evolutionComparison',
        requestId: 2,
        analysisVersion: 4,
        fromVersion: 2,
        toVersion: 4,
        comparison: null,
        error: 'Comparison unavailable.',
      },
    } as MessageEvent<unknown>);
    listener({
      data: {
        type: 'workspaceTargetResult',
        requestId: 3,
        path: '../escape.ts',
        outcome: 'opened',
      },
    } as MessageEvent<unknown>);

    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler).not.toHaveBeenCalledWith(expect.objectContaining({ path: '../escape.ts' }));
  });
});

function createSnapshot() {
  return {
    type: 'analysisSnapshot' as const,
    version: 1,
    data: {
      repository: {
        name: 'fixture',
        description: 'fixture',
        rootPath: '/repo',
        version: 1,
        analyzedAt: 1,
        durationMs: 1,
        projectType: 'library',
        repositorySize: 'small',
        packageManager: null,
        testFramework: null,
        ciSystem: null,
        languages: [],
        frameworks: [],
        counts: {
          modules: 0,
          entities: 0,
          domains: 0,
          capabilities: 0,
          knowledgeNodes: 0,
          risks: 0,
        },
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
    },
  };
}
