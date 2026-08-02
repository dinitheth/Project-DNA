/**
 * ComplexityProfile — Structural complexity analysis of the repository.
 *
 * Measures how complex the codebase is across multiple dimensions:
 * cyclomatic complexity distribution, nesting depth, coupling metrics.
 */

import { z } from 'zod';

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
