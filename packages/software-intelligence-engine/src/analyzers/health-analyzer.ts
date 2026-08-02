/**
 * HealthAnalyzer — Computes the composite RepositoryHealth score.
 *
 * Evaluates 5 dimensions entirely through deterministic heuristics:
 * architecture health, dependency health, complexity health,
 * knowledge health, and risk health.
 */

import type { Logger } from '@project-dna/shared';
import type {
  DNAObject,
  ArchitectureDNA,
  KnowledgeNode,
  RepositoryHealth,
  HealthTrend,
} from '@project-dna/dna-core';

/** Weights for each health dimension in the composite score. */
const DIMENSION_WEIGHTS = {
  architecture: 0.25,
  dependency: 0.20,
  complexity: 0.25,
  knowledge: 0.15,
  risk: 0.15,
};

export class HealthAnalyzer {
  constructor(private readonly logger: Logger) {}

  compute(
    entities: DNAObject[],
    architecture: ArchitectureDNA,
    knowledgeNodes: KnowledgeNode[],
  ): RepositoryHealth {
    this.logger.info('Computing repository health...');

    const architectureHealth = this.computeArchitectureHealth(architecture);
    const dependencyHealth = this.computeDependencyHealth(entities);
    const complexityHealth = this.computeComplexityHealth(entities);
    const knowledgeHealth = this.computeKnowledgeHealth(entities, knowledgeNodes);
    const riskHealth = this.computeRiskHealth(entities);

    const overallScore = Math.round(
      architectureHealth * DIMENSION_WEIGHTS.architecture +
      dependencyHealth * DIMENSION_WEIGHTS.dependency +
      complexityHealth * DIMENSION_WEIGHTS.complexity +
      knowledgeHealth * DIMENSION_WEIGHTS.knowledge +
      riskHealth * DIMENSION_WEIGHTS.risk,
    );

    const trend: HealthTrend = 'unknown'; // Requires evolution data

    this.logger.info(`Health computed: ${overallScore}/100`);

    return {
      overallScore,
      dimensions: {
        architectureHealth,
        dependencyHealth,
        complexityHealth,
        knowledgeHealth,
        riskHealth,
      },
      trend,
      lastComputedAt: Date.now(),
    };
  }

  private computeArchitectureHealth(architecture: ArchitectureDNA): number {
    // Higher confidence in detected pattern = better architecture health
    let score = 50; // Base score

    if (architecture.confidence > 0.8) score += 30;
    else if (architecture.confidence > 0.5) score += 15;

    // Clear layer separation is positive
    if (architecture.layers.length >= 2) score += 10;
    if (architecture.layers.length >= 3) score += 10;

    return Math.min(100, Math.max(0, score));
  }

  private computeDependencyHealth(entities: DNAObject[]): number {
    if (entities.length === 0) return 100;

    // High fan-out entities are a smell
    const avgDependencies = entities.reduce((sum, e) => sum + e.dependsOn.length, 0) / entities.length;
    const maxDependencies = Math.max(...entities.map((e) => e.dependsOn.length), 0);

    let score = 100;
    // Penalize high average dependency count
    if (avgDependencies > 15) score -= 30;
    else if (avgDependencies > 10) score -= 20;
    else if (avgDependencies > 5) score -= 10;

    // Penalize extreme fan-out
    if (maxDependencies > 30) score -= 20;
    else if (maxDependencies > 20) score -= 10;

    return Math.min(100, Math.max(0, score));
  }

  private computeComplexityHealth(entities: DNAObject[]): number {
    if (entities.length === 0) return 100;

    const complexities = entities.map((e) => e.complexity);
    const avgComplexity = complexities.reduce((sum, c) => sum + c, 0) / entities.length;
    const highComplexityCount = complexities.filter((c) => c > 20).length;
    const highComplexityRatio = highComplexityCount / entities.length;

    let score = 100;

    // Average complexity penalties
    if (avgComplexity > 20) score -= 40;
    else if (avgComplexity > 10) score -= 20;
    else if (avgComplexity > 5) score -= 5;

    // High complexity file ratio penalties
    if (highComplexityRatio > 0.3) score -= 30;
    else if (highComplexityRatio > 0.1) score -= 15;

    return Math.min(100, Math.max(0, score));
  }

  private computeKnowledgeHealth(entities: DNAObject[], _knowledgeNodes: KnowledgeNode[]): number {
    if (entities.length === 0) return 100;

    // Knowledge density across all entities
    const avgDensity = entities.reduce((sum, e) => sum + e.knowledgeDensity, 0) / entities.length;

    // Ratio of entities with at least one knowledge node
    const entitiesWithKnowledge = entities.filter((e) => e.knowledgeNodeIds.length > 0).length;
    const coverageRatio = entitiesWithKnowledge / entities.length;

    let score = 50; // Base
    score += Math.round(avgDensity * 25);
    score += Math.round(coverageRatio * 25);

    return Math.min(100, Math.max(0, score));
  }

  private computeRiskHealth(entities: DNAObject[]): number {
    if (entities.length === 0) return 100;

    // Lower risk count = higher health
    const totalRisks = entities.reduce((sum, e) => sum + e.risks.length, 0);
    const riskRatio = totalRisks / entities.length;

    let score = 100;
    if (riskRatio > 3) score -= 40;
    else if (riskRatio > 2) score -= 25;
    else if (riskRatio > 1) score -= 15;
    else if (riskRatio > 0.5) score -= 5;

    return Math.min(100, Math.max(0, score));
  }
}
