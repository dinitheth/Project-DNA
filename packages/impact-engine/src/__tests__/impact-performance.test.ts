import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { isErr } from '@project-dna/shared';
import {
  createAnalysisStateView,
  RepositoryGraph,
  type AnalysisStateView,
  type GraphEdgeAttributes,
  type ImpactOptions,
  type ImpactResult,
} from '@project-dna/dna-core';
import { ImpactEngine } from '../index.js';

const MIB = 1024 * 1024;
const engine = new ImpactEngine();

const SIZE_GATES = [
  { size: 10_000, durationMs: 50, rssGrowthBytes: 32 * MIB },
  { size: 50_000, durationMs: 200, rssGrowthBytes: 64 * MIB },
  { size: 100_000, durationMs: 500, rssGrowthBytes: 128 * MIB },
] as const;

type Scenario = 'chain' | 'high-degree-hub' | 'dense-boundary';

interface PerformanceFixture {
  readonly state: AnalysisStateView;
  readonly targetPath: string;
}

interface PerformanceSample {
  readonly durationMs: number;
  readonly rssGrowthBytes: number;
  readonly result: ImpactResult;
}

describe('ImpactEngine scalability gates', () => {
  for (const gate of SIZE_GATES) {
    it(`${formatSize(gate.size)} cold and repeated queries stay within timing and RSS ceilings`, () => {
      const samples: PerformanceSample[] = [];
      for (const scenario of ['chain', 'high-degree-hub', 'dense-boundary'] as const) {
        const fixture = createPerformanceFixture(gate.size, scenario);
        const cold = measure(fixture, {});
        const repeated = measure(fixture, {});

        report(gate.size, scenario, 'cold', cold);
        report(gate.size, scenario, 'repeated', repeated);
        samples.push(cold, repeated);
        expect(JSON.stringify(repeated.result)).toBe(JSON.stringify(cold.result));
      }
      for (const sample of samples) {
        assertCeilings(sample, gate.durationMs, gate.rssGrowthBytes);
      }
    }, 120_000);

    it(`${formatSize(gate.size)} truncated and cancelled queries stay bounded`, () => {
      const fixture = createPerformanceFixture(gate.size, 'high-degree-hub');
      const truncated = measure(fixture, {
        maxDepth: 2,
        maxEntities: 25,
        maxEvidencePaths: 1,
      });
      const cancelled = measureCancelled(fixture);

      report(gate.size, 'high-degree-hub', 'truncated', truncated);
      console.info(
        `IMPACT_BENCHMARK size=${gate.size} scenario=high-degree-hub mode=cancelled durationMs=${cancelled.durationMs.toFixed(2)} rssGrowthMiB=${toMiB(cancelled.rssGrowthBytes).toFixed(2)}`,
      );
      assertCeilings(truncated, gate.durationMs, gate.rssGrowthBytes);
      expect(truncated.result.complete).toBe(false);
      expect(truncated.result.truncations).toContainEqual({
        kind: 'max-entities',
        limit: 25,
        atEntityId: 'file:node-000026.ts',
      });
      expect(cancelled.durationMs).toBeLessThan(gate.durationMs);
      expect(cancelled.rssGrowthBytes).toBeLessThan(gate.rssGrowthBytes);
    }, 120_000);
  }
});

function createPerformanceFixture(size: number, scenario: Scenario): PerformanceFixture {
  const graph = new RepositoryGraph();
  for (let index = 0; index < size; index++) {
    const id = nodeId(index);
    graph.addFileNode(id, { label: id, path: id, language: 'typescript' });
  }
  switch (scenario) {
    case 'chain':
      for (let index = 0; index < size - 1; index++) {
        connect(graph, index, index + 1, 'import');
      }
      break;
    case 'high-degree-hub':
      for (let index = 1; index < size; index++) connect(graph, index, 0, 'import');
      break;
    case 'dense-boundary':
      for (let index = 1; index < size; index++) {
        connect(graph, index, 0, relationshipType(index));
        if (index > 1) connect(graph, index, Math.floor(index / 2), relationshipType(index + 1));
        if (index > 2) connect(graph, index, index - 1, relationshipType(index + 2));
      }
      break;
  }
  return {
    state: createAnalysisStateView({
      repositoryId: `repo:performance:${scenario}:${size}`,
      analysisVersion: 1,
      entities: [],
      graph,
      domains: [],
      capabilities: [],
      criticalComponents: [],
      risks: [],
      architecture: emptyArchitecture(),
    }),
    targetPath: scenario === 'chain' ? nodeId(size - 1) : nodeId(0),
  };
}

function measure(fixture: PerformanceFixture, options: Partial<ImpactOptions>): PerformanceSample {
  const rssBefore = process.memoryUsage.rss();
  const startedAt = performance.now();
  const result = engine.getImpact(
    {
      repositoryId: fixture.state.repositoryId,
      analysisVersion: fixture.state.analysisVersion,
      state: fixture.state,
    },
    { kind: 'file', path: fixture.targetPath },
    options,
  );
  const durationMs = performance.now() - startedAt;
  const rssGrowthBytes = Math.max(0, process.memoryUsage.rss() - rssBefore);
  if (isErr(result)) throw result.error;
  return { durationMs, rssGrowthBytes, result: result.value };
}

function measureCancelled(fixture: PerformanceFixture): Omit<PerformanceSample, 'result'> {
  const controller = new AbortController();
  controller.abort();
  const rssBefore = process.memoryUsage.rss();
  const startedAt = performance.now();
  const result = engine.getImpact(
    {
      repositoryId: fixture.state.repositoryId,
      analysisVersion: fixture.state.analysisVersion,
      state: fixture.state,
    },
    { kind: 'file', path: fixture.targetPath },
    {},
    controller.signal,
  );
  const durationMs = performance.now() - startedAt;
  const rssGrowthBytes = Math.max(0, process.memoryUsage.rss() - rssBefore);
  expect(result).toMatchObject({
    ok: false,
    error: { message: 'Impact analysis cancelled' },
  });
  return { durationMs, rssGrowthBytes };
}

function assertCeilings(
  sample: Pick<PerformanceSample, 'durationMs' | 'rssGrowthBytes'>,
  durationMs: number,
  rssGrowthBytes: number,
): void {
  expect(sample.durationMs).toBeLessThan(durationMs);
  expect(sample.rssGrowthBytes).toBeLessThan(rssGrowthBytes);
}

function report(
  size: number,
  scenario: Scenario,
  mode: 'cold' | 'repeated' | 'truncated',
  sample: PerformanceSample,
): void {
  console.info(
    `IMPACT_BENCHMARK size=${size} scenario=${scenario} mode=${mode} durationMs=${sample.durationMs.toFixed(2)} rssGrowthMiB=${toMiB(sample.rssGrowthBytes).toFixed(2)} impacted=${sample.result.directImpactedEntities.length + sample.result.transitiveImpactedEntities.length} complete=${sample.result.complete}`,
  );
}

function connect(
  graph: RepositoryGraph,
  dependent: number,
  dependency: number,
  type: GraphEdgeAttributes['type'],
): void {
  graph.addDependency(nodeId(dependent), nodeId(dependency), {
    type,
    isTypeOnly: type === 'type-import',
    specifierCount: 1,
    isExternal: false,
  });
}

function relationshipType(index: number): GraphEdgeAttributes['type'] {
  return ['import', 're-export', 'dynamic-import', 'require', 'type-import'][
    index % 5
  ] as GraphEdgeAttributes['type'];
}

function emptyArchitecture() {
  return {
    id: 'architecture:performance',
    pattern: 'unknown' as const,
    confidence: 0,
    detectedPatterns: [],
    layers: [],
    evidence: [],
    detectedAt: 1,
  };
}

function nodeId(index: number): string {
  return `node-${index.toString().padStart(6, '0')}.ts`;
}

function formatSize(size: number): string {
  return `${size / 1_000}k`;
}

function toMiB(bytes: number): number {
  return bytes / MIB;
}
