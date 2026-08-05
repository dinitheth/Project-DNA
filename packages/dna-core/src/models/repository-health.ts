/**
 * RepositoryHealth — Composite health score of the repository.
 *
 * Computed entirely from deterministic heuristics across 5 dimensions.
 * No AI. No ML. Every score maps to measurable facts.
 */

import { z } from 'zod';
import type { ArchitectureDNA } from './architecture-dna.js';
import type { DNAObject } from './dna-object.js';
import type { KnowledgeNode } from './knowledge-node.js';

export const HealthTrendSchema = z.enum(['improving', 'stable', 'degrading', 'unknown']);
export type HealthTrend = z.infer<typeof HealthTrendSchema>;

export const HealthDimensionsSchema = z.object({
  /** Layer violations, pattern consistency, separation of concerns. */
  architectureHealth: z.number().min(0).max(100),
  /** Circular dependencies, coupling scores, dependency depth. */
  dependencyHealth: z.number().min(0).max(100),
  /** Cognitive complexity distribution, nesting depth, function length. */
  complexityHealth: z.number().min(0).max(100),
  /** How well-understood is the codebase? Doc coverage, naming quality. */
  knowledgeHealth: z.number().min(0).max(100),
  /** Resilience derived from severity and affected-entity-weighted risk exposure. */
  riskHealth: z.number().min(0).max(100),
});

export type HealthDimensions = z.infer<typeof HealthDimensionsSchema>;

export const RepositoryHealthSchema = z.object({
  /** Composite health score (0-100), weighted average of dimensions. */
  overallScore: z.number().min(0).max(100),

  /** Individual health dimensions. */
  dimensions: HealthDimensionsSchema,

  /** Trend compared to previous analysis (requires evolution data). */
  trend: HealthTrendSchema,

  /** When this health score was computed. */
  lastComputedAt: z.number(),
});

export type RepositoryHealth = z.infer<typeof RepositoryHealthSchema>;

const HEALTH_DIMENSION_WEIGHTS = {
  architecture: 0.25,
  dependency: 0.2,
  complexity: 0.25,
  knowledge: 0.15,
  risk: 0.15,
} as const;

/** Recompute repository health from analyzed entities and deterministic evidence. */
export function createRepositoryHealth(input: {
  readonly entities: readonly DNAObject[];
  readonly architecture: ArchitectureDNA;
  readonly knowledgeNodes: readonly KnowledgeNode[];
  readonly riskExposureScore: number;
  readonly lastComputedAt?: number;
}): RepositoryHealth {
  const lastComputedAt = input.lastComputedAt ?? Date.now();
  if (input.entities.length === 0) {
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
      lastComputedAt,
    };
  }

  const architectureHealth = Math.round(
    Math.min(
      100,
      input.architecture.confidence * 70 + Math.min(1, input.architecture.layers.length / 3) * 30,
    ),
  );
  const averageDependencies =
    input.entities.reduce((total, entity) => total + entity.dependsOn.length, 0) /
    input.entities.length;
  const maximumDependencies = Math.max(
    ...input.entities.map((entity) => entity.dependsOn.length),
    0,
  );
  let dependencyHealth = 100;
  if (averageDependencies > 15) dependencyHealth -= 30;
  else if (averageDependencies > 10) dependencyHealth -= 20;
  else if (averageDependencies > 5) dependencyHealth -= 10;
  if (maximumDependencies > 30) dependencyHealth -= 20;
  else if (maximumDependencies > 20) dependencyHealth -= 10;
  dependencyHealth = Math.min(100, Math.max(0, dependencyHealth));

  const averageComplexity =
    input.entities.reduce((total, entity) => total + entity.complexity, 0) / input.entities.length;
  const highComplexityRatio =
    input.entities.filter((entity) => entity.complexity > 20).length / input.entities.length;
  let complexityHealth = 100;
  if (averageComplexity > 20) complexityHealth -= 40;
  else if (averageComplexity > 10) complexityHealth -= 20;
  else if (averageComplexity > 5) complexityHealth -= 5;
  if (highComplexityRatio > 0.3) complexityHealth -= 30;
  else if (highComplexityRatio > 0.1) complexityHealth -= 15;
  complexityHealth = Math.min(100, Math.max(0, complexityHealth));

  const averageKnowledgeDensity =
    input.entities.reduce((total, entity) => total + entity.knowledgeDensity, 0) /
    input.entities.length;
  const knowledgeCoverage =
    input.entities.filter((entity) => entity.knowledgeNodeIds.length > 0).length /
    input.entities.length;
  const entityReferences = new Set(input.entities.flatMap((entity) => [entity.id, entity.path]));
  const attributedKnowledge = input.knowledgeNodes.filter(
    (node) => node.sourceRef !== undefined && entityReferences.has(node.sourceRef),
  ).length;
  const knowledgeNodeDensity = Math.min(1, attributedKnowledge / input.entities.length);
  const knowledgeHealth = Math.round(
    averageKnowledgeDensity * 50 + knowledgeCoverage * 30 + knowledgeNodeDensity * 20,
  );
  const riskHealth = 100 - input.riskExposureScore;
  const overallScore = Math.round(
    architectureHealth * HEALTH_DIMENSION_WEIGHTS.architecture +
      dependencyHealth * HEALTH_DIMENSION_WEIGHTS.dependency +
      complexityHealth * HEALTH_DIMENSION_WEIGHTS.complexity +
      knowledgeHealth * HEALTH_DIMENSION_WEIGHTS.knowledge +
      riskHealth * HEALTH_DIMENSION_WEIGHTS.risk,
  );

  return {
    overallScore,
    dimensions: {
      architectureHealth,
      dependencyHealth,
      complexityHealth,
      knowledgeHealth,
      riskHealth,
    },
    trend: 'unknown',
    lastComputedAt,
  };
}
