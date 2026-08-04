/**
 * RiskAssessment — Aggregated risk model for the entire repository.
 *
 * Aggregates individual RiskNodes into a comprehensive risk picture
 * with severity distribution, top risks, and total repository exposure.
 */

import { z } from 'zod';
import { RiskSeveritySchema } from './risk-node.js';

export const RiskAssessmentSchema = z.object({
  /** Total repository risk exposure (0-100, higher = more risk). */
  overallRiskScore: z.number().min(0).max(100),

  /** Total number of risks detected. */
  totalRisks: z.number().int().nonnegative(),

  /** Distribution of risks by severity. */
  bySeverity: z.object({
    critical: z.number().int().nonnegative(),
    high: z.number().int().nonnegative(),
    medium: z.number().int().nonnegative(),
    low: z.number().int().nonnegative(),
    info: z.number().int().nonnegative(),
  }),

  /** Top risks sorted by severity (highest first). */
  topRisks: z.array(
    z.object({
      /** Risk ID. */
      riskId: z.string(),
      /** Risk type. */
      type: z.string(),
      /** Severity. */
      severity: RiskSeveritySchema,
      /** Brief description. */
      description: z.string(),
      /** Affected entities. */
      affectedEntityCount: z.number().int().nonnegative(),
    }),
  ),

  /** Risk categories with counts. */
  byCategory: z.record(z.string(), z.number().int().nonnegative()),

  /** When this assessment was computed. */
  computedAt: z.number(),
});

export type RiskAssessment = z.infer<typeof RiskAssessmentSchema>;
