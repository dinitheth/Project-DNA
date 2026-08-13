import { describe, expect, it, vi } from 'vitest';
import {
  DNAGraph,
  RepositoryGraph,
  type IProjectDNAService,
  type ProjectDNA,
} from '@project-dna/dna-core';
import { Err, Ok, type Result } from '@project-dna/shared';
import { buildSidebarData } from '../sidebar/sidebar-data.js';

describe('sidebar data', () => {
  it('uses the public query APIs and produces deterministic bounded intelligence data', async () => {
    const firstGraph = createSemanticGraph(
      [...Array.from({ length: 102 }, (_, index) => index)].reverse(),
    );
    const secondGraph = createSemanticGraph(Array.from({ length: 102 }, (_, index) => index));
    const firstService = createService({ semanticGraph: firstGraph });
    const secondService = createService({ semanticGraph: secondGraph });

    const [first, second] = await Promise.all([
      buildSidebarData(firstService.service),
      buildSidebarData(secondService.service),
    ]);

    expect(first).toEqual(second);
    expect(first.semanticGraph.nodeCount).toBe(102);
    expect(first.semanticGraph.nodes).toHaveLength(100);
    expect(first.semanticGraph.nodes[0]?.label).toBe('Node 000');
    expect(first.semanticGraph.truncated).toBe(true);
    expect(first.evolution.history.map(({ version }) => version)).toEqual([2, 1]);
    expect(first.evolution.latestSnapshot?.version).toBe(2);
    expect(firstService.calls()).toEqual({
      architecture: 1,
      health: 1,
      identity: 1,
      story: 1,
      risks: 1,
      criticalComponents: 1,
      domains: 1,
      capabilities: 1,
      knowledge: 1,
      dependencyGraph: 1,
      dnaGraph: 1,
      history: 1,
      latestSnapshot: 1,
    });
    expect(firstService.getHistory).toHaveBeenCalledWith(12);
  });

  it('rejects a mixed snapshot when Project DNA changes during query assembly', async () => {
    const harness = createService();
    harness.getCurrent
      .mockReturnValueOnce(Ok(harness.dna))
      .mockReturnValueOnce(Ok({ ...harness.dna, version: 2 }));

    await expect(buildSidebarData(harness.service)).rejects.toThrow(
      'Project DNA changed while sidebar data was being assembled',
    );
  });

  it('surfaces public query failures without publishing partial data', async () => {
    const harness = createService();
    harness.getDNAGraph.mockResolvedValueOnce(Err(new Error('semantic graph unavailable')));

    await expect(buildSidebarData(harness.service)).rejects.toThrow('semantic graph unavailable');
  });
});

function createService(options: { semanticGraph?: DNAGraph } = {}) {
  const dna = createProjectDNA();
  const getCurrent = vi.fn(() => Ok<ProjectDNA | null>(dna));
  const getArchitecture = vi.fn(() => createArchitecture());
  const getHealth = vi.fn(() => createHealth());
  const getIdentity = vi.fn(() => createIdentity());
  const getStory = vi.fn(() => createStory());
  const getRisks = vi.fn(() => createRisks());
  const getCriticalComponents = vi.fn(() => [
    { name: 'Core', path: 'src/core.ts', criticality: 'high', score: 0.8, reason: 'Central' },
  ]);
  const getDomains = vi.fn(async () => Ok([]));
  const getCapabilities = vi.fn(async () => Ok([]));
  const getKnowledge = vi.fn(async () => Ok([]));
  const getDependencyGraph = vi.fn(async () => Ok(new RepositoryGraph()));
  const getDNAGraph = vi.fn(async (): Promise<Result<DNAGraph>> =>
    Ok(options.semanticGraph ?? createSemanticGraph([0, 1])),
  );
  const snapshots = [createSnapshot(1), createSnapshot(2)];
  const getHistory = vi.fn(async () => Ok(snapshots));
  const getLatestSnapshot = vi.fn(async () => Ok(snapshots[1]!));
  const service = {
    getCurrent,
    getArchitecture,
    getHealth,
    getIdentity,
    getStory,
    getRisks,
    getCriticalComponents,
    getDomains,
    getCapabilities,
    getKnowledge,
    getDependencyGraph,
    getDNAGraph,
    getHistory,
    getLatestSnapshot,
  } as unknown as IProjectDNAService;
  return {
    service,
    dna,
    getCurrent,
    getDNAGraph,
    getHistory,
    calls: () => ({
      architecture: getArchitecture.mock.calls.length,
      health: getHealth.mock.calls.length,
      identity: getIdentity.mock.calls.length,
      story: getStory.mock.calls.length,
      risks: getRisks.mock.calls.length,
      criticalComponents: getCriticalComponents.mock.calls.length,
      domains: getDomains.mock.calls.length,
      capabilities: getCapabilities.mock.calls.length,
      knowledge: getKnowledge.mock.calls.length,
      dependencyGraph: getDependencyGraph.mock.calls.length,
      dnaGraph: getDNAGraph.mock.calls.length,
      history: getHistory.mock.calls.length,
      latestSnapshot: getLatestSnapshot.mock.calls.length,
    }),
  };
}

function createSemanticGraph(order: number[]): DNAGraph {
  const graph = new DNAGraph();
  for (const index of order) {
    graph.addNode(`node:${index}`, {
      kind: 'entity',
      label: `Node ${index.toString().padStart(3, '0')}`,
      weight: 1 - index / 200,
      metadata: {},
    });
  }
  for (let index = 0; index < 101; index++) {
    graph.addEdge(`node:${index}`, `node:${index + 1}`, {
      kind: 'depends-on',
      weight: 0.5,
      confidence: 0.9,
    });
  }
  return graph;
}

function createProjectDNA(): ProjectDNA {
  return {
    id: 'project-dna',
    version: 1,
    rootPath: 'C:/repo',
    analyzedAt: 1,
    durationMs: 10,
    moduleCount: 1,
    entityCount: 2,
    domainCount: 0,
    capabilityCount: 0,
    knowledgeNodeCount: 0,
    riskCount: 0,
    analysisCoverage: { scanned: 2, parsed: 2, skipped: 0, failed: 0 },
    complexity: {
      averageComplexity: 1,
      maxComplexity: 2,
      mostComplexFile: null,
      complexCodePercentage: 0,
      averageNestingDepth: 1,
      maxNestingDepth: 1,
    },
  } as unknown as ProjectDNA;
}

function createArchitecture() {
  return {
    pattern: 'layered',
    confidence: 0.8,
    detectedAt: 1,
    detectedPatterns: [{ pattern: 'layered', confidence: 0.8 }],
    layers: [],
    evidence: [],
  } as unknown as ReturnType<IProjectDNAService['getArchitecture']>;
}

function createHealth() {
  return {
    overallScore: 90,
    trend: 'stable',
    dimensions: {
      architectureHealth: 90,
      dependencyHealth: 90,
      complexityHealth: 90,
      knowledgeHealth: 90,
      riskHealth: 90,
    },
  } as ReturnType<IProjectDNAService['getHealth']>;
}

function createIdentity() {
  return {
    name: 'Project DNA',
    description: 'Repository intelligence',
    projectType: 'monorepo',
    repositorySize: 'small',
    packageManager: 'pnpm',
    testFramework: 'vitest',
    ciSystem: null,
    primaryLanguages: [],
    frameworks: [],
  } as unknown as ReturnType<IProjectDNAService['getIdentity']>;
}

function createStory() {
  return {
    summary: 'Summary',
    healthSummary: 'Healthy',
    architectureSummary: 'Layered architecture',
    criticalPath: 'Core',
    risks: [],
  } as unknown as ReturnType<IProjectDNAService['getStory']>;
}

function createRisks() {
  return {
    overallRiskScore: 10,
    totalRisks: 0,
    bySeverity: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
    topRisks: [],
  } as unknown as ReturnType<IProjectDNAService['getRisks']>;
}

function createSnapshot(version: number) {
  return {
    id: `snapshot-${version}`,
    version,
    timestamp: version,
    trigger: version === 1 ? ('manual' as const) : ('incremental' as const),
    projectDnaHash: `hash-${version}`,
    gitCommitHash: null,
    metrics: { 'health.overall': 90 },
    parentSnapshotId: version === 1 ? null : 'snapshot-1',
    isFullSnapshot: version === 1,
    projectDnaRef: null,
  };
}
