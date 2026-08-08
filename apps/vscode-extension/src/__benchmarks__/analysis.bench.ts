import { bench, describe } from 'vitest';
import {
  assertPerformanceCeiling,
  formatAnalysisBenchmarkReport,
  measureRepositoryAnalysis,
  PERFORMANCE_SCENARIO_LIMITS,
} from '../benchmarks/analysis-benchmark.js';
import {
  RepositoryBenchmarkScenarios,
  createRepositoryBenchmarkFixture,
} from '../benchmarks/repository-benchmark-fixture.js';

const scenarioName = process.env['PROJECT_DNA_BENCHMARK_SCENARIO'] ?? 'small';
const scenario = scenarioByName(scenarioName);

describe(`Project DNA repository analysis (${scenario.name})`, () => {
  let fixture: Awaited<ReturnType<typeof createRepositoryBenchmarkFixture>> | undefined;
  let expectedFingerprint: string | undefined;
  let latestReport: string | undefined;

  bench(
    'full analysis',
    async () => {
      if (!fixture) throw new Error('Benchmark fixture was not initialized');
      const sample = await measureRepositoryAnalysis(fixture.rootPath);
      if (scenario.name in PERFORMANCE_SCENARIO_LIMITS) {
        assertPerformanceCeiling(sample, scenario.name as keyof typeof PERFORMANCE_SCENARIO_LIMITS);
      }
      if (expectedFingerprint && sample.semanticFingerprint !== expectedFingerprint) {
        throw new Error('Benchmark iterations produced different semantic Project DNA output');
      }
      expectedFingerprint = sample.semanticFingerprint;
      latestReport = formatAnalysisBenchmarkReport(sample);
    },
    {
      iterations: 1,
      time: 0,
      warmupIterations: 0,
      warmupTime: 0,
      setup: async () => {
        fixture = await createRepositoryBenchmarkFixture(scenario);
      },
      teardown: async () => {
        if (latestReport) process.stdout.write(`${latestReport}\n`);
        await fixture?.cleanup();
        fixture = undefined;
      },
    },
  );
});

function scenarioByName(name: string) {
  if (name in RepositoryBenchmarkScenarios) {
    return RepositoryBenchmarkScenarios[name as keyof typeof RepositoryBenchmarkScenarios];
  }
  throw new Error(`Unknown Project DNA benchmark scenario: ${name}`);
}
