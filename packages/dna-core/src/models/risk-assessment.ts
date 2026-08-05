/**
 * RiskAssessment — Aggregated risk model for the entire repository.
 *
 * Aggregates individual RiskNodes into a comprehensive risk picture
 * with severity distribution, top risks, and total repository exposure.
 */

import { z } from 'zod';
import { RiskSeveritySchema, type RiskNode } from './risk-node.js';

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

const RISK_SEVERITY_WEIGHTS: Record<RiskNode['severity'], number> = {
  info: 1,
  low: 2,
  medium: 4,
  high: 7,
  critical: 10,
};

const RISK_EXPOSURE_SCALE = 25;

/** Compute total repository risk exposure from severity and affected-entity counts. */
export function calculateRiskExposureScore(risks: readonly RiskNode[]): number {
  const exposure = risks.reduce((total, risk) => {
    const affectedEntityCount = Math.max(1, new Set(risk.affectedEntities).size);
    return total + RISK_SEVERITY_WEIGHTS[risk.severity] * affectedEntityCount;
  }, 0);
  return Math.round(100 * (1 - Math.exp(-exposure / RISK_EXPOSURE_SCALE)));
}

/** Sort risks by deterministic repository exposure priority. */
export function compareRiskExposure(left: RiskNode, right: RiskNode): number {
  const severityDifference =
    RISK_SEVERITY_WEIGHTS[right.severity] - RISK_SEVERITY_WEIGHTS[left.severity];
  if (severityDifference !== 0) return severityDifference;
  const impactDifference =
    new Set(right.affectedEntities).size - new Set(left.affectedEntities).size;
  return impactDifference !== 0 ? impactDifference : left.id.localeCompare(right.id);
}

/** Aggregate raw risk observations into the persisted repository assessment. */
export function createRiskAssessment(
  risks: readonly RiskNode[],
  computedAt = Date.now(),
): RiskAssessment {
  const bySeverity = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  const byCategory = new Map<string, number>();
  for (const risk of risks) {
    bySeverity[risk.severity]++;
    byCategory.set(risk.type, (byCategory.get(risk.type) ?? 0) + 1);
  }
  const topRisks = [...risks]
    .sort(compareRiskExposure)
    .slice(0, 10)
    .map((risk) => ({
      riskId: risk.id,
      type: risk.type,
      severity: risk.severity,
      description: risk.description,
      affectedEntityCount: new Set(risk.affectedEntities).size,
    }));
  return {
    overallRiskScore: calculateRiskExposureScore(risks),
    totalRisks: risks.length,
    bySeverity,
    topRisks,
    byCategory: Object.fromEntries(byCategory),
    computedAt,
  };
}
