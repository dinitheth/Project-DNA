import { describe, expect, it } from 'vitest';
import { ExtensionMessageSchema } from '@project-dna/shared';
import { initialImpactState, reduceImpactState, restoreImpactState } from './impact-state.js';

describe('impact state', () => {
  it('accepts only the latest correlated result', () => {
    const first = select('src/a.ts', 3, 1);
    const second = reduceImpactState(first, {
      type: 'select',
      requestId: 2,
      analysisVersion: 3,
      target: { kind: 'file', path: 'src/b.ts' },
    });
    const late = reduceImpactState(second, { type: 'message', message: result(1, 'src/a.ts', 3) });
    const accepted = reduceImpactState(late, {
      type: 'message',
      message: result(2, 'src/b.ts', 3),
    });

    expect(late).toBe(second);
    expect(accepted.status).toBe('ready');
    expect(accepted.result?.target.path).toBe('src/b.ts');
  });

  it('clears an active query when a newer analysis snapshot arrives', () => {
    const selected = select('src/a.ts', 3, 1);
    const refreshed = reduceImpactState(selected, {
      type: 'message',
      message: ExtensionMessageSchema.parse({
        type: 'analysisSnapshot',
        version: 4,
        data: snapshot(4),
      }),
    });

    expect(refreshed).toEqual({ ...initialImpactState, requestId: 1 });
  });

  it('keeps query errors explicit without accepting another target result', () => {
    const selected = select('src/a.ts', 3, 1);
    const errored = reduceImpactState(selected, {
      type: 'message',
      message: ExtensionMessageSchema.parse({
        type: 'impactResult',
        requestId: 1,
        analysisVersion: 3,
        target: { kind: 'file', path: 'src/a.ts' },
        result: null,
        error: 'Impact analysis cancelled.',
      }),
    });
    expect(errored).toMatchObject({ status: 'error', error: 'Impact analysis cancelled.' });
  });

  it('cancels locally and ignores a late response for the same request', () => {
    const selected = select('src/a.ts', 3, 1);
    const cancelled = reduceImpactState(selected, { type: 'cancel', requestId: 1 });
    const late = reduceImpactState(cancelled, {
      type: 'message',
      message: result(1, 'src/a.ts', 3),
    });
    expect(cancelled.status).toBe('cancelled');
    expect(late).toBe(cancelled);
  });

  it('rejects a response whose target does not match the active request', () => {
    const selected = select('src/a.ts', 3, 1);
    expect(
      reduceImpactState(selected, { type: 'message', message: result(1, 'src/b.ts', 3) }),
    ).toBe(selected);
  });

  it('restores a pending request for webview recreation and rejects malformed state', () => {
    const selected = select('src/a.ts', 3, 7);
    expect(restoreImpactState({ impact: selected })).toEqual(selected);
    expect(
      restoreImpactState({ impact: { ...selected, target: { kind: 'class', id: 'A' } } }),
    ).toEqual(initialImpactState);
  });
});

function select(path: string, analysisVersion: number, requestId: number) {
  return reduceImpactState(initialImpactState, {
    type: 'select',
    requestId,
    analysisVersion,
    target: { kind: 'file', path },
  });
}

function result(requestId: number, path: string, analysisVersion: number) {
  return ExtensionMessageSchema.parse({
    type: 'impactResult',
    requestId,
    analysisVersion,
    target: { kind: 'file', path },
    result: {
      repositoryId: 'repo',
      analysisVersion,
      target: { id: `file:${path}`, kind: 'file', name: path, path, minimumDepth: 0 },
      directImpactedEntities: [],
      transitiveImpactedEntities: [],
      minimumDepth: null,
      canonicalPaths: [],
      semanticEffects: {
        domains: [],
        capabilities: [],
        criticalComponents: [],
        risks: [],
        architecture: { layers: [], boundaryCrossings: [] },
      },
      score: { total: 0, components: scoreComponents() },
      evidence: [],
      warnings: [],
      complete: true,
      truncations: [],
      appliedBounds: { maxDepth: 8, maxEntities: 500, maxEvidencePaths: 1 },
    },
  });
}

function scoreComponents() {
  return [
    'dependency-reach',
    'critical-component-exposure',
    'domain-reach',
    'risk-exposure',
    'architecture-boundaries',
  ].map((kind) => ({
    kind,
    rawInput: 0,
    normalizedValue: 0,
    weight: 0,
    contribution: 0,
    evidenceIds: [],
    status: 'available',
  }));
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
