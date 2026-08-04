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
  RiskNode,
  RepositoryHealth,
  HealthTrend,
} from '@project-dna/dna-core';
import { calculateRiskExposureScore } from './risk-exposure.js';

/** Weights for each health dimension in the composite score. */
const DIMENSION_WEIGHTS = {
  architecture: 0.25,
  dependency: 0.2,
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
    risks: RiskNode[] = [],
  ): RepositoryHealth {
    this.logger.info('Computing repository health...');

    if (entities.length === 0) {
      return {
        overallScore: 0,
        dimensions: {
          architectureHealth: 0,
          dependencyHealth: 0,
          complexityHealth: 0,
          knowledgeHealth: 0,
          riskHealth: 0,
        },
        trend: 'unknown',
        lastComputedAt: Date.now(),
      };
    }

    const architectureHealth = this.computeArchitectureHealth(architecture);
    const dependencyHealth = this.computeDependencyHealth(entities);
    const complexityHealth = this.computeComplexityHealth(entities);
    const knowledgeHealth = this.computeKnowledgeHealth(entities, knowledgeNodes);
    const riskHealth = this.computeRiskHealth(entities, risks);

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
    const patternEvidence = architecture.confidence * 70;
    const layerEvidence = Math.min(1, architecture.layers.length / 3) * 30;
    return Math.round(Math.min(100, patternEvidence + layerEvidence));
  }

  private computeDependencyHealth(entities: DNAObject[]): number {
    if (entities.length === 0) return 100;

    // High fan-out entities are a smell
    const avgDependencies =
      entities.reduce((sum, e) => sum + e.dependsOn.length, 0) / entities.length;
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

  private computeKnowledgeHealth(entities: DNAObject[], knowledgeNodes: KnowledgeNode[]): number {
    if (entities.length === 0) return 0;

    // Knowledge density across all entities
    const avgDensity = entities.reduce((sum, e) => sum + e.knowledgeDensity, 0) / entities.length;

    // Ratio of entities with at least one knowledge node
    const entitiesWithKnowledge = entities.filter((e) => e.knowledgeNodeIds.length > 0).length;
    const coverageRatio = entitiesWithKnowledge / entities.length;

    const entityReferences = new Set(entities.flatMap((entity) => [entity.id, entity.path]));
    const attributedKnowledge = knowledgeNodes.filter(
      (node) => node.sourceRef !== undefined && entityReferences.has(node.sourceRef),
    ).length;
    const nodeDensity = Math.min(1, attributedKnowledge / entities.length);
    return Math.round(avgDensity * 50 + coverageRatio * 30 + nodeDensity * 20);
  }

  private computeRiskHealth(entities: DNAObject[], risks: RiskNode[]): number {
    if (entities.length === 0) return 0;
    if (risks.length === 0) return 100;

    return 100 - calculateRiskExposureScore(risks);
  }
}
