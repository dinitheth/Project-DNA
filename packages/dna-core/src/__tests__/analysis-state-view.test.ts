import { describe, expect, it } from 'vitest';
import {
  createAnalysisStateGraphView,
  createAnalysisStateView,
  createRepositoryGraphFromAnalysisState,
  serializeAnalysisStateView,
  RepositoryGraph,
  type AnalysisStateViewInput,
  type DNAObject,
} from '../index.js';

describe('AnalysisStateView', () => {
  it('is deterministic across collection and graph insertion order', () => {
    const first = createAnalysisStateView(fixture(false));
    const reversed = createAnalysisStateView(fixture(true));

    expect(serializeAnalysisStateView(first)).toBe(serializeAnalysisStateView(reversed));
    expect(first).toEqual(reversed);
  });

  it('is deeply immutable and independent of its source values', () => {
    const input = fixture(false);
    const state = createAnalysisStateView(input);
    input.entities[0]!.dependsOn.push('file:changed.ts');

    expect(state.entities[0]!.dependsOn).not.toContain('file:changed.ts');
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.entities)).toBe(true);
    expect(Object.isFrozen(state.entities[0]!.dependsOn)).toBe(true);
  });

  it('restores an equivalent private repository graph', () => {
    const state = createAnalysisStateView(fixture(true));
    const graph = createRepositoryGraphFromAnalysisState(state);

    expect(graph.getNodeIds().sort()).toEqual(['a.ts', 'b.ts']);
    expect(graph.getDependencies('a.ts')).toEqual(['b.ts']);
    expect(graph.getEdgeAttributes('a.ts', 'b.ts')).toEqual({
      type: 'import',
      isTypeOnly: false,
      specifierCount: 1,
      isExternal: false,
    });
  });

  it('caches traversal indexes only for the exact immutable state identity', () => {
    const first = createAnalysisStateView(fixture(false));
    const equivalent = createAnalysisStateView(fixture(false));
    const firstView = createAnalysisStateGraphView(first);

    expect(createAnalysisStateGraphView(first)).toBe(firstView);
    expect(createAnalysisStateGraphView(equivalent)).not.toBe(firstView);
    expect(createAnalysisStateGraphView(first)).not.toBe(firstView);
  });

  it('evicts old traversal indexes after the bounded cache limit', () => {
    const oldest = createAnalysisStateView({ ...fixture(false), analysisVersion: 100 });
    const oldestView = createAnalysisStateGraphView(oldest);
    for (let version = 101; version <= 108; version++) {
      createAnalysisStateView({ ...fixture(false), analysisVersion: version });
    }

    expect(createAnalysisStateGraphView(oldest)).not.toBe(oldestView);
  });
});

function fixture(reverse: boolean): AnalysisStateViewInput & { entities: DNAObject[] } {
  const graph = new RepositoryGraph();
  const nodeIds = reverse ? ['b.ts', 'a.ts'] : ['a.ts', 'b.ts'];
  for (const id of nodeIds) graph.addFileNode(id, { label: id, path: id, language: 'typescript' });
  graph.addDependency('a.ts', 'b.ts', {
    type: 'import',
    isTypeOnly: false,
    specifierCount: 1,
    isExternal: false,
  });
  const entities = [entity('file:a.ts', 'a.ts', ['file:b.ts']), entity('file:b.ts', 'b.ts', [])];
  if (reverse) entities.reverse();
  return {
    repositoryId: 'repo:test',
    analysisVersion: 2,
    entities,
    graph,
    domains: [
      {
        id: 'domain:core',
        name: 'core',
        inferenceSource: 'folder-structure',
        confidence: 0.9,
        rootPaths: ['src/core', 'src'],
        entityIds: reverse ? ['file:b.ts', 'file:a.ts'] : ['file:a.ts', 'file:b.ts'],
        fileCount: 2,
        linesOfCode: 20,
        primaryLanguages: ['typescript'],
        dependsOn: [],
        dependedOnBy: [],
        detectedAt: 1,
      },
    ],
    capabilities: [],
    criticalComponents: [],
    risks: [],
    architecture: {
      id: 'architecture:test',
      pattern: 'layered',
      confidence: 0.8,
      detectedPatterns: [{ pattern: 'layered', confidence: 0.8 }],
      layers: [{ name: 'core', directories: ['src/core'], fileCount: 2, role: 'domain' }],
      evidence: [],
      detectedAt: 1,
    },
  };
}

function entity(id: string, path: string, dependsOn: string[]): DNAObject {
  return {
    id,
    kind: 'file',
    name: path,
    path,
    purpose: 'test',
    architectureRole: 'unknown',
    businessDomain: 'core',
    importance: 0.5,
    criticality: 'medium',
    complexity: 1,
    healthScore: 1,
    risks: [],
    dependsOn,
    dependedOnBy: id === 'file:b.ts' ? ['file:a.ts'] : [],
    belongsToDomain: 'domain:core',
    belongsToLayer: 'core',
    knowledgeNodeIds: [],
    knowledgeDensity: 0,
    confidence: 1,
    lastAnalyzedAt: 1,
  };
}
