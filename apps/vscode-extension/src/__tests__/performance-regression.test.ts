import { appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AnalysisPerformanceStages,
  AnalysisPerformanceTracker,
  type IProjectDNAService,
} from '@project-dna/dna-core';
import {
  DNAEventNames,
  EventBus,
  TOKENS,
  createSilentLogger,
  isErr,
  type DNAEventMap,
} from '@project-dna/shared';
import {
  PERFORMANCE_REGRESSION_LIMITS,
  assertPerformanceCeiling,
  analyzeRepositoryWithoutInstrumentation,
  createSemanticFingerprint,
  measureRepositoryAnalysis,
} from '../benchmarks/analysis-benchmark.js';
import {
  RepositoryBenchmarkScenarios,
  createRepositoryBenchmarkFixture,
  type RepositoryBenchmarkFixture,
  type RepositoryBenchmarkFixtureOptions,
} from '../benchmarks/repository-benchmark-fixture.js';
import { createContainer } from '../container.js';

const fixtures: RepositoryBenchmarkFixture[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
});

describe('Project DNA performance baseline', () => {
  it('generates deterministic benchmark repositories', async () => {
    const first = await createFixture();
    const second = await createFixture();

    expect(first.sourcePaths).toEqual(second.sourcePaths);
    expect(first.unsupportedPaths).toEqual(second.unsupportedPaths);
    const relativePath = first.sourcePaths.at(-1);
    if (!relativePath) throw new Error('Benchmark fixture did not create enough source files');
    const [firstContent, secondContent] = await Promise.all([
      readFile(path.join(first.rootPath, relativePath), 'utf8'),
      readFile(path.join(second.rootPath, relativePath), 'utf8'),
    ]);
    expect(firstContent).toBe(secondContent);
  });

  it('records every M4 boundary without changing M3 output or exceeding the baseline budget', async () => {
    const fixture = await createFixture();
    vi.spyOn(Date, 'now').mockReturnValue(1_750_000_000_000);
    const sample = await measureRepositoryAnalysis(fixture.rootPath, {
      workerCount: 2,
      minimumParallelFiles: 1,
    });
    const uninstrumented = await analyzeRepositoryWithoutInstrumentation(fixture.rootPath, {
      workerCount: 1,
      minimumParallelFiles: 1,
    });
    const stages = new Set(sample.report.measurements.map((measurement) => measurement.stage));

    expect(stages).toEqual(
      new Set([
        AnalysisPerformanceStages.Total,
        AnalysisPerformanceStages.StartupRecovery,
        AnalysisPerformanceStages.RepositoryScan,
        AnalysisPerformanceStages.AstAnalysis,
        AnalysisPerformanceStages.DependencyGraph,
        AnalysisPerformanceStages.CircularDependencies,
        AnalysisPerformanceStages.ArchitectureInference,
        AnalysisPerformanceStages.DirtySetPlanning,
        AnalysisPerformanceStages.KnowledgeGeneration,
        AnalysisPerformanceStages.DnaSynthesis,
        AnalysisPerformanceStages.Intelligence,
        AnalysisPerformanceStages.EvolutionSnapshot,
        AnalysisPerformanceStages.Persistence,
      ]),
    );
    expect(
      sample.report.measurements.every((measurement) => measurement.outcome === 'success'),
    ).toBe(true);
    expect(sample.report.totalDurationMs).toBeLessThan(
      PERFORMANCE_REGRESSION_LIMITS.totalDurationMs,
    );
    expect(sample.report.peakRssBytes - sample.report.initialMemory.rssBytes).toBeLessThan(
      PERFORMANCE_REGRESSION_LIMITS.rssGrowthBytes,
    );
    expect(sample.serializedBytes).toBeGreaterThan(0);
    expect(sample.cpuTimeMs).toBeGreaterThan(0);
    expect(sample.averageCpuCores).toBeGreaterThan(0);
    expect(sample.cpuUtilizationPercent).toBeGreaterThan(0);
    expect(JSON.stringify(sample.dna)).toBe(JSON.stringify(uninstrumented));
  }, 60_000);

  it('falls back to sequential parsing when the worker entry point fails', async () => {
    const fixture = await createFixture();
    vi.spyOn(Date, 'now').mockReturnValue(1_750_000_000_000);
    const logger = createSilentLogger();
    const warning = vi.spyOn(logger, 'warn');
    const sequential = await analyzeRepositoryWithoutInstrumentation(fixture.rootPath, {
      workerCount: 1,
      minimumParallelFiles: 1,
    });
    const fallback = await analyzeRepositoryWithoutInstrumentation(fixture.rootPath, {
      workerCount: 4,
      minimumParallelFiles: 1,
      workerScriptPath: path.join(fixture.rootPath, 'missing-ast-worker.js'),
      logger,
    });

    expect(JSON.stringify(fallback)).toBe(JSON.stringify(sequential));
    expect(warning).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining('Parallel AST parsing unavailable; retrying sequentially'),
    );
  }, 60_000);

  it('keeps incremental parsing parallel and semantically equivalent to a full rebuild', async () => {
    const fixture = await createFixture();
    vi.spyOn(Date, 'now').mockReturnValue(1_750_000_000_000);
    const tracker = new AnalysisPerformanceTracker();
    const container = createContainer({
      logger: createSilentLogger(),
      performanceRecorder: tracker,
      astEngineOptions: { workerCount: 2, minimumParallelFiles: 1 },
    });
    const service = container.resolve<IProjectDNAService>(TOKENS.ProjectDNAService);

    const initial = await service.analyze(fixture.rootPath);
    if (isErr(initial)) throw initial.error;
    const changedPath = fixture.sourcePaths[0];
    if (!changedPath) throw new Error('Missing incremental fixture path');
    await appendFile(
      path.join(fixture.rootPath, changedPath),
      '\nexport const changed = true;\n',
      'utf8',
    );
    container
      .resolve<EventBus<DNAEventMap>>(TOKENS.EventBus)
      .emit(DNAEventNames.RepositoryFilesChanged, {
        rootPath: fixture.rootPath,
        watcherEpoch: 1,
        sequence: 1,
        observedAt: Date.now(),
        changes: [{ kind: 'modified', path: changedPath }],
      });
    const incremental = await service.refresh();
    if (isErr(incremental)) throw incremental.error;
    const full = await measureRepositoryAnalysis(fixture.rootPath, {
      workerCount: 1,
      minimumParallelFiles: 1,
    });

    expect(createSemanticFingerprint(incremental.value)).toBe(full.semanticFingerprint);
    expect(
      tracker
        .createReport()
        .measurements.filter(
          (measurement) => measurement.stage === AnalysisPerformanceStages.AstAnalysis,
        ),
    ).toHaveLength(2);
    await service.dispose();
  }, 60_000);

  it('repeats a medium repository deterministically within its scalability ceiling', async () => {
    const fixture = await createFixture(RepositoryBenchmarkScenarios.medium);
    const first = await measureRepositoryAnalysis(fixture.rootPath, {
      workerCount: 4,
      minimumParallelFiles: 1,
    });
    const second = await measureRepositoryAnalysis(fixture.rootPath, {
      workerCount: 4,
      minimumParallelFiles: 1,
    });

    expect(second.semanticFingerprint).toBe(first.semanticFingerprint);
    assertPerformanceCeiling(first, 'medium');
    assertPerformanceCeiling(second, 'medium');
  }, 180_000);
});

async function createFixture(
  scenario: RepositoryBenchmarkFixtureOptions = RepositoryBenchmarkScenarios.regression,
): Promise<RepositoryBenchmarkFixture> {
  const fixture = await createRepositoryBenchmarkFixture(scenario);
  fixtures.push(fixture);
  return fixture;
}
