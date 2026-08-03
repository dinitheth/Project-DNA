/** Deterministic software intelligence computation. */

import { Err, Ok, type Logger, type Result } from '@project-dna/shared';
import type {
  IntelligenceInput,
  IntelligenceOutput,
  ISoftwareIntelligenceEngine,
} from '@project-dna/dna-core';
import { ComplexityAnalyzer } from './analyzers/complexity-analyzer.js';
import { CriticalityAnalyzer } from './analyzers/criticality-analyzer.js';
import { HealthAnalyzer } from './analyzers/health-analyzer.js';
import { RiskAggregator } from './analyzers/risk-aggregator.js';
import { StoryGenerator } from './narrative/story-generator.js';

export class SoftwareIntelligenceEngine implements ISoftwareIntelligenceEngine {
  private readonly healthAnalyzer: HealthAnalyzer;
  private readonly complexityAnalyzer: ComplexityAnalyzer;
  private readonly riskAggregator: RiskAggregator;
  private readonly criticalityAnalyzer: CriticalityAnalyzer;
  private readonly storyGenerator: StoryGenerator;

  constructor(private readonly logger: Logger) {
    this.healthAnalyzer = new HealthAnalyzer(logger);
    this.complexityAnalyzer = new ComplexityAnalyzer(logger);
    this.riskAggregator = new RiskAggregator(logger);
    this.criticalityAnalyzer = new CriticalityAnalyzer(logger);
    this.storyGenerator = new StoryGenerator(logger);
  }

  async computeIntelligence(
    input: IntelligenceInput,
    signal?: AbortSignal,
  ): Promise<Result<IntelligenceOutput>> {
    try {
      if (signal?.aborted) return Err(new Error('Intelligence computation cancelled'));
      this.logger.info('Starting intelligence computation...');
      const startTime = Date.now();

      const health = this.healthAnalyzer.compute(
        input.entities,
        input.architecture,
        input.knowledgeNodes,
      );
      if (signal?.aborted) return Err(new Error('Intelligence computation cancelled'));

      const complexity = this.complexityAnalyzer.compute(input.entities);
      if (signal?.aborted) return Err(new Error('Intelligence computation cancelled'));

      const risks = this.riskAggregator.aggregate(input.risks);
      if (signal?.aborted) return Err(new Error('Intelligence computation cancelled'));

      const criticalComponents = this.criticalityAnalyzer.identify(input.entities);
      if (signal?.aborted) return Err(new Error('Intelligence computation cancelled'));

      const domainCount = new Set(
        input.entities.map((entity) => entity.businessDomain).filter(Boolean),
      ).size;
      const story = this.storyGenerator.generate(
        input.profile,
        health,
        input.architecture,
        criticalComponents,
        risks,
        domainCount,
      );

      const durationMs = Date.now() - startTime;
      this.logger.info(
        `Intelligence computation complete: health=${health.overallScore}/100, ` +
          `${criticalComponents.length} critical components, ` +
          `${risks.totalRisks} risks (${durationMs}ms)`,
      );
      return Ok({ health, complexity, risks, criticalComponents, story });
    } catch (error) {
      const resolvedError = error instanceof Error ? error : new Error(String(error));
      this.logger.error(`Intelligence computation failed: ${resolvedError.message}`);
      return Err(resolvedError);
    }
  }
}
