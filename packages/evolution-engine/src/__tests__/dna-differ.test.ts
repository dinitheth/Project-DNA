import { describe, expect, it } from 'vitest';
import { createAnalysisStateView, RepositoryGraph, type DNAObject } from '@project-dna/dna-core';
import { DNADiffer } from '../diff/dna-differ.js';

describe('DNADiffer shared analysis changes', () => {
  it('uses the canonical state change set instead of metric placeholders', () => {
    const from = snapshot(state(['A.ts', 'B.ts'], true, 1), 1);
    const to = snapshot(state(['A.ts', 'C.ts'], false, 2), 2);
    const diff = new DNADiffer(logger()).computeDiff(from, to);

    expect(diff.addedEntities).toEqual(['file:C.ts']);
    expect(diff.removedEntities).toEqual(['file:B.ts']);
    expect(diff.addedEdges).toBe(0);
    expect(diff.removedEdges).toBe(1);
    expect(diff.newRisks).toEqual(['risk:A']);
    expect(diff.newDomains).toEqual([]);
  });

  it('keeps legacy fallback semantics for snapshots without a state view', () => {
    const base = snapshot(undefined, 1);
    const diff = new DNADiffer(logger()).computeDiff(base, { ...base, version: 2 });
    expect(diff.addedEntities).toEqual([]);
    expect(diff.removedEntities).toEqual([]);
    expect(diff.addedEdges).toBe(0);
  });
});

function snapshot(analysisState: ReturnType<typeof state> | undefined, version: number) {
  return {
    id: `snapshot-${version}`,
    version,
    timestamp: 1,
    trigger: 'manual' as const,
    projectDnaHash: 'hash',
    gitCommitHash: null,
    metrics: {
      'health.overall': 80,
      'health.architecture': 80,
      'health.dependency': 80,
      'health.complexity': 80,
      'health.knowledge': 80,
      'health.risk': 80,
      'entities.total': 2,
      'domains.total': 1,
    },
    parentSnapshotId: null,
    isFullSnapshot: true,
    projectDnaRef: 'snapshot:ref',
    ...(analysisState ? { analysisState } : {}),
  };
}

function state(paths: string[], edge: boolean, version: number) {
  const graph = new RepositoryGraph();
  for (const path of paths) graph.addFileNode(path, { label: path, path });
  if (edge) {
    graph.addDependency('A.ts', 'B.ts', {
      type: 'import',
      isTypeOnly: false,
      specifierCount: 1,
      isExternal: false,
    });
  }
  const entities = paths.map((path) =>
    entity(path, path === 'A.ts' && version > 1 ? ['risk:A'] : []),
  );
  return createAnalysisStateView({
    repositoryId: 'repo:evolution',
    analysisVersion: version,
    entities,
    graph,
    domains: [],
    capabilities: [],
    criticalComponents: [],
    risks: paths.includes('A.ts') && version > 1 ? [risk('risk:A')] : [],
    architecture: null,
  });
}

function entity(path: string, risks: string[]): DNAObject {
  return {
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
    risks,
    dependsOn: [],
    dependedOnBy: [],
    belongsToDomain: null,
    belongsToLayer: null,
    knowledgeNodeIds: [],
    knowledgeDensity: 0,
    confidence: 1,
    lastAnalyzedAt: 1,
  };
}

function risk(id: string) {
  return {
    id,
    type: 'high-complexity' as const,
    severity: 'high' as const,
    affectedEntities: ['A.ts'],
    description: 'fixture',
    detectedAt: 1,
  };
}

function logger() {
  return {
    trace() {},
    debug() {},
    info() {},
    warn() {},
    error() {},
    fatal() {},
    child() {
      return this;
    },
  };
}
