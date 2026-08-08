import { createHash } from 'node:crypto';
import { availableParallelism, cpus } from 'node:os';
import { performance } from 'node:perf_hooks';
import {
  AnalysisPerformanceTracker,
  type AnalysisPerformanceReport,
  type IProjectDNAService,
  type ProjectDNA,
} from '@project-dna/dna-core';
import { TOKENS, createSilentLogger, isErr, type Logger } from '@project-dna/shared';
import { createContainer } from '../container.js';

/** Broad M3 baseline ceilings used to detect catastrophic performance regressions. */
export const PERFORMANCE_REGRESSION_LIMITS = {
  totalDurationMs: 30_000,
  rssGrowthBytes: 512 * 1024 * 1024,
} as const;

/** Machine-tolerant ceilings that still detect material medium/large scalability regressions. */
export const PERFORMANCE_SCENARIO_LIMITS = {
  medium: {
    totalDurationMs: 90_000,
    rssGrowthBytes: 1536 * 1024 * 1024,
  },
  large: {
    totalDurationMs: 240_000,
    rssGrowthBytes: 2560 * 1024 * 1024,
  },
} as const;

/** One measured full-analysis sample from the real application composition root. */
export interface AnalysisBenchmarkSample {
  readonly dna: ProjectDNA;
  readonly report: AnalysisPerformanceReport;
  readonly serializedBytes: number;
  readonly semanticFingerprint: string;
  readonly cpuTimeMs: number;
  readonly averageCpuCores: number;
  readonly cpuUtilizationPercent: number;
  readonly memoryAfterDispose: {
    readonly rssBytes: number;
    readonly heapUsedBytes: number;
  };
}

/** Optional AST execution controls used by baseline and equivalence comparisons. */
export interface AnalysisBenchmarkOptions {
  readonly workerCount?: number;
  readonly minimumParallelFiles?: number;
  readonly workerScriptPath?: string;
  readonly logger?: Logger;
}

export function assertPerformanceCeiling(
  sample: AnalysisBenchmarkSample,
  scenario: keyof typeof PERFORMANCE_SCENARIO_LIMITS,
): void {
  const limit = PERFORMANCE_SCENARIO_LIMITS[scenario];
  if (sample.report.totalDurationMs >= limit.totalDurationMs) {
    throw new Error(
      `${scenario} analysis exceeded ${limit.totalDurationMs} ms: ${sample.report.totalDurationMs.toFixed(2)} ms`,
    );
  }
  const rssGrowth = sample.report.peakRssBytes - sample.report.initialMemory.rssBytes;
  if (rssGrowth >= limit.rssGrowthBytes) {
    throw new Error(
      `${scenario} analysis exceeded ${limit.rssGrowthBytes} bytes RSS growth: ${rssGrowth} bytes`,
    );
  }
}

/** Execute one isolated full analysis with opt-in timing and memory instrumentation. */
export async function measureRepositoryAnalysis(
  rootPath: string,
  options: AnalysisBenchmarkOptions = {},
): Promise<AnalysisBenchmarkSample> {
  const tracker = new AnalysisPerformanceTracker();
  const cpuStart = process.cpuUsage();
  const wallStart = performance.now();
  const dna = await analyzeRepository(rootPath, tracker, options);
  const memoryAfterDispose = process.memoryUsage();
  const wallDurationMs = Math.max(0.001, performance.now() - wallStart);
  const cpu = process.cpuUsage(cpuStart);
  const cpuTimeMs = (cpu.user + cpu.system) / 1_000;
  const averageCpuCores = cpuTimeMs / wallDurationMs;
  const logicalCpuCount =
    typeof availableParallelism === 'function' ? availableParallelism() : cpus().length;
  const serialized = JSON.stringify(dna);
  return {
    dna,
    report: tracker.createReport(),
    serializedBytes: Buffer.byteLength(serialized, 'utf8'),
    semanticFingerprint: createSemanticFingerprint(dna),
    cpuTimeMs,
    averageCpuCores,
    cpuUtilizationPercent: (averageCpuCores / Math.max(1, logicalCpuCount)) * 100,
    memoryAfterDispose: {
      rssBytes: memoryAfterDispose.rss,
      heapUsedBytes: memoryAfterDispose.heapUsed,
    },
  };
}

/** Execute the same full-analysis path without performance instrumentation. */
export async function analyzeRepositoryWithoutInstrumentation(
  rootPath: string,
  options: AnalysisBenchmarkOptions = {},
): Promise<ProjectDNA> {
  return analyzeRepository(rootPath, undefined, options);
}

/** Format a stable, human-readable stage report for benchmark output. */
export function formatAnalysisBenchmarkReport(sample: AnalysisBenchmarkSample): string {
  const lines = sample.report.measurements.map((measurement) => {
    const heapDelta =
      measurement.memoryAfter.heapUsedBytes - measurement.memoryBefore.heapUsedBytes;
    return `${measurement.stage.padEnd(24)} ${measurement.durationMs.toFixed(2).padStart(10)} ms ${formatSignedBytes(heapDelta).padStart(12)}`;
  });
  return [
    'Project DNA analysis stage baseline',
    'stage                    duration       heap delta',
    ...lines,
    `peak rss                 ${formatBytes(sample.report.peakRssBytes)}`,
    `peak heap                ${formatBytes(sample.report.peakHeapUsedBytes)}`,
    `rss after dispose        ${formatBytes(sample.memoryAfterDispose.rssBytes)}`,
    `heap after dispose       ${formatBytes(sample.memoryAfterDispose.heapUsedBytes)}`,
    `serialized Project DNA   ${formatBytes(sample.serializedBytes)}`,
    `cpu time                 ${sample.cpuTimeMs.toFixed(2)} ms`,
    `average cpu cores        ${sample.averageCpuCores.toFixed(2)}`,
    `host cpu utilization     ${sample.cpuUtilizationPercent.toFixed(2)}%`,
    `semantic fingerprint     ${sample.semanticFingerprint}`,
  ].join('\n');
}

async function analyzeRepository(
  rootPath: string,
  performanceRecorder?: AnalysisPerformanceTracker,
  options: AnalysisBenchmarkOptions = {},
): Promise<ProjectDNA> {
  const { logger = createSilentLogger(), ...astEngineOptions } = options;
  const container = createContainer({
    logger,
    performanceRecorder,
    astEngineOptions,
  });
  const service = container.resolve<IProjectDNAService>(TOKENS.ProjectDNAService);

  try {
    const result = await service.analyze(rootPath);
    if (isErr(result)) throw result.error;
    return result.value;
  } finally {
    await service.dispose();
  }
}

/** Hash the stable semantic portion of Project DNA for equivalence assertions. */
export function createSemanticFingerprint(dna: ProjectDNA): string {
  return createHash('sha256')
    .update(JSON.stringify(normalizeSemanticValue(dna)))
    .digest('hex');
}

function formatSignedBytes(bytes: number): string {
  return `${bytes > 0 ? '+' : ''}${formatBytes(bytes)}`;
}

function formatBytes(bytes: number): string {
  const absolute = Math.abs(bytes);
  if (absolute < 1024) return `${bytes} B`;
  const units = ['KiB', 'MiB', 'GiB'] as const;
  let value = bytes / 1024;
  let unit: (typeof units)[number] = units[0];
  for (const nextUnit of units.slice(1)) {
    if (Math.abs(value) < 1024) break;
    value /= 1024;
    unit = nextUnit;
  }
  return `${value.toFixed(2)} ${unit}`;
}

const VOLATILE_ANALYSIS_KEYS = new Set([
  'analyzedAt',
  'computedAt',
  'createdAt',
  'detectedAt',
  'durationMs',
  'dependencyGraphRef',
  'dnaGraphRef',
  'generatedAt',
  'identifiedAt',
  'lastAnalyzedAt',
  'lastComputedAt',
  'updatedAt',
  'version',
]);

function normalizeSemanticValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeSemanticValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !VOLATILE_ANALYSIS_KEYS.has(key))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, normalizeSemanticValue(nested)]),
  );
}
