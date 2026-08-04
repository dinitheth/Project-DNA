import { describe, expect, it } from 'vitest';
import {
  ExtensionMessageSchema,
  RepositoryDataSchema,
  WebviewMessageSchema,
} from '../protocol/messages.js';

describe('webview message protocol', () => {
  it('accepts supported webview requests and rejects unknown message shapes', () => {
    expect(WebviewMessageSchema.safeParse({ type: 'ready' }).success).toBe(true);
    expect(WebviewMessageSchema.safeParse({ type: 'requestAnalysis' }).success).toBe(true);
    expect(
      WebviewMessageSchema.safeParse({ type: 'navigateTo', view: 'dependencies' }).success,
    ).toBe(true);
    expect(WebviewMessageSchema.safeParse({ type: 'navigateTo', view: 'unknown' }).success).toBe(
      false,
    );
    expect(WebviewMessageSchema.safeParse({ type: 'deleteRepository' }).success).toBe(false);
  });

  it('validates live repository payloads at the extension-to-webview boundary', () => {
    const data = createRepositoryData();

    expect(RepositoryDataSchema.safeParse(data).success).toBe(true);
    expect(ExtensionMessageSchema.safeParse({ type: 'repositoryData', data }).success).toBe(true);
    expect(
      ExtensionMessageSchema.safeParse({
        type: 'repositoryData',
        data: { ...data, health: { ...data.health, overallScore: 101 } },
      }).success,
    ).toBe(false);
  });

  it('accepts one versioned atomic analysis snapshot', () => {
    const repository = createRepositoryData();
    const message = {
      type: 'analysisSnapshot',
      version: repository.version,
      data: {
        repository,
        architecture: {
          pattern: 'unknown',
          confidence: 0,
          detectedAt: 1,
          detectedPatterns: [],
          layers: [],
          evidence: [],
          summary: 'No architecture pattern detected.',
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
    };

    expect(ExtensionMessageSchema.safeParse(message).success).toBe(true);
  });

  it('preserves the legacy analysis completion contract', () => {
    expect(
      ExtensionMessageSchema.safeParse({
        type: 'analysisComplete',
        summary: {
          fileCount: 3,
          languageCount: 1,
          architecturePattern: 'unknown',
          knowledgeNodeCount: 0,
          durationMs: 10,
        },
      }).success,
    ).toBe(true);
  });

  it('rejects invalid progress percentages and accepts the unavailable state', () => {
    expect(
      ExtensionMessageSchema.safeParse({ type: 'analysisUnavailable', rootPath: null }).success,
    ).toBe(true);
    expect(
      ExtensionMessageSchema.safeParse({
        type: 'analysisProgress',
        stage: 'scanning',
        message: 'Scanning',
        percent: 101,
      }).success,
    ).toBe(false);
  });
});

function createRepositoryData() {
  return {
    name: 'Project DNA',
    description: 'Repository intelligence',
    rootPath: 'C:/project-dna',
    version: 1,
    analyzedAt: 1,
    durationMs: 10,
    projectType: 'monorepo',
    repositorySize: 'small',
    packageManager: 'pnpm',
    testFramework: 'vitest',
    ciSystem: null,
    languages: [{ language: 'typescript', percentage: 100, fileCount: 3, linesOfCode: 50 }],
    frameworks: [],
    counts: {
      modules: 2,
      entities: 3,
      domains: 1,
      capabilities: 1,
      knowledgeNodes: 2,
      risks: 0,
    },
    coverage: { scanned: 3, parsed: 3, skipped: 0, failed: 0 },
    health: {
      overallScore: 90,
      trend: 'stable',
      dimensions: {
        architectureHealth: 90,
        dependencyHealth: 90,
        complexityHealth: 90,
        knowledgeHealth: 90,
        riskHealth: 90,
      },
    },
    complexity: {
      averageComplexity: 1,
      maxComplexity: 2,
      mostComplexFile: null,
      complexCodePercentage: 0,
      averageNestingDepth: 1,
      maxNestingDepth: 1,
    },
    risks: {
      overallRiskScore: 0,
      totalRisks: 0,
      bySeverity: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
      topRisks: [],
    },
    criticalComponents: [],
    story: {
      summary: 'A healthy repository.',
      healthSummary: 'Health is stable.',
      criticalPath: 'No critical path detected.',
      risks: [],
    },
  };
}
