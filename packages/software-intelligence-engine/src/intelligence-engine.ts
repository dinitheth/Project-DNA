/**
 * SoftwareIntelligenceEngine — The reasoning layer implementation.
 *
 * Implements ISoftwareIntelligenceEngine. Takes synthesized DNA and produces
 * actionable intelligence through deterministic heuristics.
 * No AI. No ML. No probabilistic models.
 */

import { Ok, Err } from '@project-dna/shared';
import type { Logger, Result } from '@project-dna/shared';
import type {
  ISoftwareIntelligenceEngine,
  IntelligenceInput,
  IntelligenceOutput,
  RiskNode,
} from '@project-dna/dna-core';
import { HealthAnalyzer } from './analyzers/health-analyzer.js';
import { ComplexityAnalyzer } from './analyzers/complexity-analyzer.js';
import { RiskAggregator } from './analyzers/risk-aggregator.js';
import { CriticalityAnalyzer } from './analyzers/criticality-analyzer.js';
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
    _signal?: AbortSignal,
  ): Promise<Result<IntelligenceOutput>> {
    try {
      this.logger.info('Starting intelligence computation...');
      const startTime = Date.now();

      // Step 1: Compute health across 5 dimensions
      const health = this.healthAnalyzer.compute(
        input.entities,
        input.architecture,
        input.knowledgeNodes,
      );

      // Step 2: Compute complexity profile
      const complexity = this.complexityAnalyzer.compute(input.entities);

      // Step 3: Aggregate risks
      // Extract risk nodes from entity risk IDs (simplified: create stubs)
      const riskNodes = this.extractRiskNodes(input.entities);
      const risks = this.riskAggregator.aggregate(riskNodes);

      // Step 4: Identify critical components
      const criticalComponents = this.criticalityAnalyzer.identify(input.entities);

      // Step 5: Generate deterministic narrative
      const domainCount = new Set(
        input.entities.map((e) => e.businessDomain).filter(Boolean),
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

      return Ok({
        health,
        complexity,
        risks,
        criticalComponents,
        story,
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(`Intelligence computation failed: ${err.message}`);
      return Err(err);
    }
  }

  /**
   * Extract risk node stubs from entity risk IDs.
   * In the full pipeline, actual RiskNode objects flow through from the KnowledgeEngine.
   * This provides a fallback for when only entity-level risk IDs are available.
   */
  private extractRiskNodes(entities: readonly { risks: string[] }[]): RiskNode[] {
    const riskIds = new Set<string>();
    for (const entity of entities) {
      for (const riskId of entity.risks) {
        riskIds.add(riskId);
      }
    }
    // Return minimal stubs — the real pipeline passes full RiskNode objects
    return Array.from(riskIds).map((id) => ({
      id,
      type: 'high-complexity' as const,
      severity: 'medium' as const,
      affectedEntities: [] as string[],
      description: `Risk ${id}`,
      detectedAt: Date.now(),
    }));
  }
}
