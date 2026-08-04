import { describe, expect, it } from 'vitest';
import { ExtensionMessageSchema } from '@project-dna/shared';
import { initialAnalysisState, reduceAnalysisState } from './analysis-state';

describe('analysis state', () => {
  it('accepts only a complete version-consistent snapshot', () => {
    const snapshot = createSnapshot(2, 2);
    const ready = reduceAnalysisState(initialAnalysisState, snapshot);

    expect(ready.status).toBe('ready');
    expect(ready.repository?.version).toBe(2);

    const mismatched = reduceAnalysisState(ready, createSnapshot(3, 4));
    expect(mismatched).toBe(ready);

    const stale = reduceAnalysisState(ready, createSnapshot(1, 1));
    expect(stale).toBe(ready);

    const otherWorkspace = reduceAnalysisState(ready, createSnapshot(3, 3, 'C:/other-repository'));
    expect(otherWorkspace).toBe(ready);
  });

  it('clears previous data on a new analysis or error and ignores partial payloads', () => {
    const ready = reduceAnalysisState(initialAnalysisState, createSnapshot(1, 1));
    const partial = ExtensionMessageSchema.parse({
      type: 'repositoryData',
      data: ready.repository,
    });
    expect(reduceAnalysisState(ready, partial)).toBe(ready);

    const analyzing = reduceAnalysisState(
      ready,
      ExtensionMessageSchema.parse({ type: 'analysisStarted', rootPath: 'C:/repo' }),
    );
    expect(analyzing.status).toBe('analyzing');
    expect(analyzing.repository).toBeNull();

    const failed = reduceAnalysisState(
      analyzing,
      ExtensionMessageSchema.parse({ type: 'analysisError', message: 'failed' }),
    );
    expect(failed.status).toBe('error');
    expect(failed.repository).toBeNull();
  });

  it('retains the accepted version while analyzing and rejects delayed prior snapshots', () => {
    const ready = reduceAnalysisState(initialAnalysisState, createSnapshot(2, 2));
    const analyzing = reduceAnalysisState(
      ready,
      ExtensionMessageSchema.parse({ type: 'analysisStarted', rootPath: 'C:/repo' }),
    );

    expect(analyzing.latestVersion).toBe(2);
    expect(reduceAnalysisState(analyzing, createSnapshot(2, 2))).toBe(analyzing);

    const next = reduceAnalysisState(analyzing, createSnapshot(3, 3));
    expect(next.status).toBe('ready');
    expect(next.latestVersion).toBe(3);

    const failed = reduceAnalysisState(
      analyzing,
      ExtensionMessageSchema.parse({ type: 'analysisError', message: 'failed' }),
    );
    expect(failed.latestVersion).toBe(2);
    expect(reduceAnalysisState(failed, createSnapshot(2, 2))).toBe(failed);
  });

  it('preserves a valid snapshot when a non-analysis data request fails', () => {
    const ready = reduceAnalysisState(initialAnalysisState, createSnapshot(1, 1));
    const withError = reduceAnalysisState(
      ready,
      ExtensionMessageSchema.parse({
        type: 'analysisError',
        message: 'Sidebar data could not be refreshed',
        stage: 'sidebar-data',
      }),
    );

    expect(withError.status).toBe('ready');
    expect(withError.repository?.version).toBe(1);
    expect(withError.error).toBe('Sidebar data could not be refreshed');
  });
});

function createSnapshot(messageVersion: number, repositoryVersion: number, rootPath = 'C:/repo') {
  return ExtensionMessageSchema.parse({
    type: 'analysisSnapshot',
    version: messageVersion,
    data: {
      repository: {
        name: 'fixture',
        description: 'fixture',
        rootPath,
        version: repositoryVersion,
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
    },
  });
}
