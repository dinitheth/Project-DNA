import { performance } from 'node:perf_hooks';

/** Stable identifiers for the measurable boundaries of one Project DNA analysis. */
export const AnalysisPerformanceStages = {
  Total: 'analysis-total',
  StartupRecovery: 'startup-recovery',
  RepositoryScan: 'repository-scan',
  AstAnalysis: 'ast-analysis',
  DependencyGraph: 'dependency-graph',
  CircularDependencies: 'circular-dependencies',
  ArchitectureInference: 'architecture-inference',
  DirtySetPlanning: 'dirty-set-planning',
  KnowledgeGeneration: 'knowledge-generation',
  DnaSynthesis: 'dna-synthesis',
  Intelligence: 'intelligence',
  EvolutionSnapshot: 'evolution-snapshot',
  Persistence: 'persistence',
} as const;

/** A measurable boundary in the Project DNA analysis pipeline. */
export type AnalysisPerformanceStage =
  (typeof AnalysisPerformanceStages)[keyof typeof AnalysisPerformanceStages];

/** Process memory captured at an analysis boundary. */
export interface AnalysisMemoryUsage {
  readonly rssBytes: number;
  readonly heapTotalBytes: number;
  readonly heapUsedBytes: number;
  readonly externalBytes: number;
  readonly arrayBuffersBytes: number;
}

/** One completed timing and memory measurement. */
export interface AnalysisPerformanceMeasurement {
  readonly sequence: number;
  readonly stage: AnalysisPerformanceStage;
  readonly durationMs: number;
  readonly outcome: 'success' | 'failure';
  readonly memoryBefore: AnalysisMemoryUsage;
  readonly memoryAfter: AnalysisMemoryUsage;
}

/** Immutable report for all measurements recorded since the last reset. */
export interface AnalysisPerformanceReport {
  readonly measurements: readonly AnalysisPerformanceMeasurement[];
  readonly totalDurationMs: number;
  readonly initialMemory: AnalysisMemoryUsage;
  readonly finalMemory: AnalysisMemoryUsage;
  readonly peakRssBytes: number;
  readonly peakHeapUsedBytes: number;
}

/** Optional recorder contract accepted by analysis composition roots. */
export interface AnalysisPerformanceRecorder {
  measure<T>(stage: AnalysisPerformanceStage, operation: () => Promise<T> | T): Promise<T>;
  measureSync<T>(stage: AnalysisPerformanceStage, operation: () => T): T;
}

/** Test and benchmark adapters for deterministic clocks and memory samples. */
export interface AnalysisPerformanceTrackerOptions {
  readonly now?: () => number;
  readonly readMemory?: () => AnalysisMemoryUsage;
  /** Periodic peak-memory sampling interval. Zero disables background sampling. */
  readonly sampleIntervalMs?: number;
}

/**
 * Records opt-in stage timings and process-memory samples without changing analysis output.
 * The tracker is repository-agnostic and stores no source code or domain data.
 */
export class AnalysisPerformanceTracker implements AnalysisPerformanceRecorder {
  private readonly now: () => number;
  private readonly readMemory: () => AnalysisMemoryUsage;
  private readonly sampleIntervalMs: number;
  private measurements: AnalysisPerformanceMeasurement[] = [];
  private nextSequence = 0;
  private activeMeasurements = 0;
  private initialMemory: AnalysisMemoryUsage;
  private finalMemory: AnalysisMemoryUsage;
  private peakRssBytes: number;
  private peakHeapUsedBytes: number;
  private memorySampler: NodeJS.Timeout | null = null;

  constructor(options: AnalysisPerformanceTrackerOptions = {}) {
    this.now = options.now ?? (() => performance.now());
    this.readMemory = options.readMemory ?? readProcessMemory;
    this.sampleIntervalMs = normalizeSampleInterval(options.sampleIntervalMs);
    const initialMemory = this.readMemory();
    this.initialMemory = initialMemory;
    this.finalMemory = initialMemory;
    this.peakRssBytes = initialMemory.rssBytes;
    this.peakHeapUsedBytes = initialMemory.heapUsedBytes;
  }

  /** Measure one synchronous or asynchronous analysis operation. */
  async measure<T>(stage: AnalysisPerformanceStage, operation: () => Promise<T> | T): Promise<T> {
    const context = this.startMeasurement(stage);
    let outcome: AnalysisPerformanceMeasurement['outcome'] = 'success';

    try {
      return await operation();
    } catch (error) {
      outcome = 'failure';
      throw error;
    } finally {
      this.finishMeasurement(context, outcome);
    }
  }

  /** Measure one synchronous analysis operation without introducing an async boundary. */
  measureSync<T>(stage: AnalysisPerformanceStage, operation: () => T): T {
    const context = this.startMeasurement(stage);
    let outcome: AnalysisPerformanceMeasurement['outcome'] = 'success';

    try {
      return operation();
    } catch (error) {
      outcome = 'failure';
      throw error;
    } finally {
      this.finishMeasurement(context, outcome);
    }
  }

  /** Return an immutable snapshot of the current measurements. */
  createReport(): AnalysisPerformanceReport {
    const measurements = [...this.measurements].sort(
      (left, right) => left.sequence - right.sequence,
    );
    const totalDurationMs = measurements
      .filter((measurement) => measurement.stage === AnalysisPerformanceStages.Total)
      .reduce((total, measurement) => total + measurement.durationMs, 0);
    return {
      measurements: measurements.map(copyMeasurement),
      totalDurationMs,
      initialMemory: { ...this.initialMemory },
      finalMemory: { ...this.finalMemory },
      peakRssBytes: this.peakRssBytes,
      peakHeapUsedBytes: this.peakHeapUsedBytes,
    };
  }

  /** Clear completed measurements before recording another benchmark sample. */
  reset(): void {
    if (this.activeMeasurements > 0) {
      throw new Error('Cannot reset analysis performance tracking while measurements are active');
    }
    const initialMemory = this.readMemory();
    this.measurements = [];
    this.nextSequence = 0;
    this.initialMemory = initialMemory;
    this.finalMemory = initialMemory;
    this.peakRssBytes = initialMemory.rssBytes;
    this.peakHeapUsedBytes = initialMemory.heapUsedBytes;
  }

  private captureMemory(): AnalysisMemoryUsage {
    const memory = this.readMemory();
    this.recordMemory(memory);
    return memory;
  }

  private recordMemory(memory: AnalysisMemoryUsage): void {
    this.finalMemory = memory;
    this.peakRssBytes = Math.max(this.peakRssBytes, memory.rssBytes);
    this.peakHeapUsedBytes = Math.max(this.peakHeapUsedBytes, memory.heapUsedBytes);
  }

  private startMeasurement(stage: AnalysisPerformanceStage): ActiveMeasurement {
    if (this.activeMeasurements === 0) this.startMemorySampler();
    const context = {
      sequence: this.nextSequence++,
      stage,
      startedAt: this.now(),
      memoryBefore: this.captureMemory(),
    };
    this.activeMeasurements++;
    return context;
  }

  private finishMeasurement(
    context: ActiveMeasurement,
    outcome: AnalysisPerformanceMeasurement['outcome'],
  ): void {
    const durationMs = Math.max(0, this.now() - context.startedAt);
    const memoryAfter = this.captureMemory();
    this.measurements.push({
      sequence: context.sequence,
      stage: context.stage,
      durationMs,
      outcome,
      memoryBefore: context.memoryBefore,
      memoryAfter,
    });
    this.activeMeasurements--;
    if (this.activeMeasurements === 0) this.stopMemorySampler();
  }

  private startMemorySampler(): void {
    if (this.sampleIntervalMs === 0 || this.memorySampler) return;
    this.memorySampler = setInterval(
      () => this.recordMemory(this.readMemory()),
      this.sampleIntervalMs,
    );
    this.memorySampler.unref();
  }

  private stopMemorySampler(): void {
    if (!this.memorySampler) return;
    clearInterval(this.memorySampler);
    this.memorySampler = null;
  }
}

/** Measure an asynchronous boundary when an opt-in recorder is available. */
export async function measureAnalysisPerformance<T>(
  recorder: AnalysisPerformanceRecorder | undefined,
  stage: AnalysisPerformanceStage,
  operation: () => Promise<T> | T,
): Promise<T> {
  return recorder ? recorder.measure(stage, operation) : operation();
}

/** Measure a synchronous boundary while preserving its original scheduling semantics. */
export function measureAnalysisPerformanceSync<T>(
  recorder: AnalysisPerformanceRecorder | undefined,
  stage: AnalysisPerformanceStage,
  operation: () => T,
): T {
  return recorder ? recorder.measureSync(stage, operation) : operation();
}

function readProcessMemory(): AnalysisMemoryUsage {
  const memory = process.memoryUsage();
  return {
    rssBytes: memory.rss,
    heapTotalBytes: memory.heapTotal,
    heapUsedBytes: memory.heapUsed,
    externalBytes: memory.external,
    arrayBuffersBytes: memory.arrayBuffers,
  };
}

function copyMeasurement(
  measurement: AnalysisPerformanceMeasurement,
): AnalysisPerformanceMeasurement {
  return {
    ...measurement,
    memoryBefore: { ...measurement.memoryBefore },
    memoryAfter: { ...measurement.memoryAfter },
  };
}

interface ActiveMeasurement {
  readonly sequence: number;
  readonly stage: AnalysisPerformanceStage;
  readonly startedAt: number;
  readonly memoryBefore: AnalysisMemoryUsage;
}

function normalizeSampleInterval(configured: number | undefined): number {
  if (configured === undefined) return 50;
  return Number.isFinite(configured) && configured >= 0 ? configured : 50;
}
