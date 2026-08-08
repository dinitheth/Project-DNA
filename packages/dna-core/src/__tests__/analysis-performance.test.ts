import { describe, expect, it } from 'vitest';
import {
  AnalysisPerformanceStages,
  AnalysisPerformanceTracker,
  type AnalysisMemoryUsage,
} from '../performance/analysis-performance.js';

describe('AnalysisPerformanceTracker', () => {
  it('records deterministic timing, memory, ordering, and outcomes', async () => {
    const clock = sequence([10, 16, 20, 29]);
    const memory = memorySequence([100, 110, 130, 125, 150]);
    const tracker = new AnalysisPerformanceTracker({
      now: clock,
      readMemory: memory,
      sampleIntervalMs: 0,
    });

    expect(tracker.measureSync(AnalysisPerformanceStages.RepositoryScan, () => 'scan')).toBe(
      'scan',
    );
    await expect(
      tracker.measure(AnalysisPerformanceStages.AstAnalysis, async () => {
        throw new Error('parse failed');
      }),
    ).rejects.toThrow('parse failed');

    expect(tracker.createReport()).toEqual({
      measurements: [
        {
          sequence: 0,
          stage: AnalysisPerformanceStages.RepositoryScan,
          durationMs: 6,
          outcome: 'success',
          memoryBefore: usage(110),
          memoryAfter: usage(130),
        },
        {
          sequence: 1,
          stage: AnalysisPerformanceStages.AstAnalysis,
          durationMs: 9,
          outcome: 'failure',
          memoryBefore: usage(125),
          memoryAfter: usage(150),
        },
      ],
      totalDurationMs: 0,
      initialMemory: usage(100),
      finalMemory: usage(150),
      peakRssBytes: 150,
      peakHeapUsedBytes: 75,
    });
  });

  it('reports total analysis duration and resets between benchmark samples', async () => {
    const tracker = new AnalysisPerformanceTracker({
      now: sequence([0, 25]),
      readMemory: memorySequence([200, 210, 220, 205]),
      sampleIntervalMs: 0,
    });

    await tracker.measure(AnalysisPerformanceStages.Total, () => Promise.resolve());
    expect(tracker.createReport().totalDurationMs).toBe(25);

    tracker.reset();
    expect(tracker.createReport()).toEqual({
      measurements: [],
      totalDurationMs: 0,
      initialMemory: usage(205),
      finalMemory: usage(205),
      peakRssBytes: 205,
      peakHeapUsedBytes: 102,
    });
  });

  it('does not allow an active measurement to be reset', async () => {
    let release: (() => void) | undefined;
    const operation = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tracker = new AnalysisPerformanceTracker();
    const measurement = tracker.measure(AnalysisPerformanceStages.Total, () => operation);

    expect(() => tracker.reset()).toThrow(
      'Cannot reset analysis performance tracking while measurements are active',
    );
    release?.();
    await measurement;
  });
});

function sequence(values: readonly number[]): () => number {
  let index = 0;
  return () => {
    const value = values[index];
    if (value === undefined) throw new Error('Clock sequence exhausted');
    index++;
    return value;
  };
}

function memorySequence(values: readonly number[]): () => AnalysisMemoryUsage {
  const next = sequence(values);
  return () => usage(next());
}

function usage(rssBytes: number): AnalysisMemoryUsage {
  return {
    rssBytes,
    heapTotalBytes: Math.floor(rssBytes * 0.75),
    heapUsedBytes: Math.floor(rssBytes * 0.5),
    externalBytes: Math.floor(rssBytes * 0.1),
    arrayBuffersBytes: Math.floor(rssBytes * 0.05),
  };
}
