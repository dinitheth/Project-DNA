/**
 * ComplexityProfile — Structural complexity analysis of the repository.
 *
 * Measures how complex the codebase is across multiple dimensions:
 * cyclomatic complexity distribution, nesting depth, coupling metrics.
 */

import { z } from 'zod';
import type { DNAObject } from './dna-object.js';

export const ComplexityDistributionSchema = z.object({
  /** Number of entities in each complexity bucket. */
  low: z.number().int().nonnegative(),
  medium: z.number().int().nonnegative(),
  high: z.number().int().nonnegative(),
  critical: z.number().int().nonnegative(),
});

export type ComplexityDistribution = z.infer<typeof ComplexityDistributionSchema>;

export const ComplexityProfileSchema = z.object({
  /** Average cyclomatic complexity across all files. */
  averageComplexity: z.number().nonnegative(),

  /** Maximum cyclomatic complexity of any single function. */
  maxComplexity: z.number().nonnegative(),

  /** Path of the most complex file. */
  mostComplexFile: z.string().nullable(),

  /** Distribution of files across complexity buckets. */
  distribution: ComplexityDistributionSchema,

  /** Average nesting depth across all functions. */
  averageNestingDepth: z.number().nonnegative(),

  /** Maximum nesting depth found. */
  maxNestingDepth: z.number().int().nonnegative(),

  /** Percentage of code covered by complex functions (complexity > threshold). */
  complexCodePercentage: z.number().min(0).max(100),

  /** Afferent coupling — average number of incoming dependencies per module. */
  averageAfferentCoupling: z.number().nonnegative(),

  /** Efferent coupling — average number of outgoing dependencies per module. */
  averageEfferentCoupling: z.number().nonnegative(),

  /** Instability index — Ce / (Ca + Ce), averaged across modules. */
  averageInstability: z.number().min(0).max(1),

  /** When this profile was computed. */
  computedAt: z.number(),
});

export type ComplexityProfile = z.infer<typeof ComplexityProfileSchema>;

/** Compute the deterministic repository complexity profile from persisted entities. */
export function createComplexityProfile(
  entities: readonly DNAObject[],
  computedAt = Date.now(),
): ComplexityProfile {
  const complexities = entities.map((entity) => entity.complexity);
  const averageComplexity =
    complexities.length > 0
      ? complexities.reduce((total, complexity) => total + complexity, 0) / complexities.length
      : 0;
  const maxComplexity = complexities.length > 0 ? Math.max(...complexities) : 0;
  const mostComplexEntity = entities.reduce<DNAObject | null>(
    (current, entity) =>
      current === null || entity.complexity > current.complexity ? entity : current,
    null,
  );

  const distribution: ComplexityDistribution = { low: 0, medium: 0, high: 0, critical: 0 };
  for (const complexity of complexities) {
    if (complexity <= 5) distribution.low++;
    else if (complexity <= 15) distribution.medium++;
    else if (complexity <= 30) distribution.high++;
    else distribution.critical++;
  }

  let totalAfferent = 0;
  let totalEfferent = 0;
  let totalInstability = 0;
  for (const entity of entities) {
    const afferent = entity.dependedOnBy.length;
    const efferent = entity.dependsOn.length;
    totalAfferent += afferent;
    totalEfferent += efferent;
    const totalCoupling = afferent + efferent;
    totalInstability += totalCoupling > 0 ? efferent / totalCoupling : 0;
  }
  const entityCount = entities.length;
  const highComplexityCount = complexities.filter((complexity) => complexity > 15).length;

  return {
    averageComplexity: Math.round(averageComplexity * 100) / 100,
    maxComplexity,
    mostComplexFile: mostComplexEntity?.path ?? null,
    distribution,
    averageNestingDepth: 0,
    maxNestingDepth: 0,
    complexCodePercentage:
      entityCount > 0 ? Math.round((highComplexityCount / entityCount) * 100 * 10) / 10 : 0,
    averageAfferentCoupling:
      entityCount > 0 ? Math.round((totalAfferent / entityCount) * 100) / 100 : 0,
    averageEfferentCoupling:
      entityCount > 0 ? Math.round((totalEfferent / entityCount) * 100) / 100 : 0,
    averageInstability:
      entityCount > 0 ? Math.round((totalInstability / entityCount) * 100) / 100 : 0,
    computedAt,
  };
}
