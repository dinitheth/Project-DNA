/**
 * RepositoryHealth — Composite health score of the repository.
 *
 * Computed entirely from deterministic heuristics across 5 dimensions.
 * No AI. No ML. Every score maps to measurable facts.
 */

import { z } from 'zod';

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
  /** Severity-weighted aggregate risk score. */
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
