/**
 * RiskAggregator — Aggregates individual risk nodes into RiskAssessment.
 *
 * Computes overall risk score, severity distribution, top risks,
 * and categorization from raw risk data.
 */

import type { Logger } from '@project-dna/shared';
import type { RiskNode, RiskAssessment } from '@project-dna/dna-core';

const SEVERITY_WEIGHTS: Record<string, number> = {
  critical: 10,
  high: 5,
  medium: 2,
  low: 1,
  info: 0,
};

export class RiskAggregator {
  constructor(private readonly logger: Logger) {}

  aggregate(risks: RiskNode[]): RiskAssessment {
    this.logger.info(`Aggregating ${risks.length} risks...`);

    const bySeverity = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    const byCategory = new Map<string, number>();
    let totalWeightedScore = 0;

    for (const risk of risks) {
      // Count by severity
      const sev = risk.severity as keyof typeof bySeverity;
      if (sev in bySeverity) bySeverity[sev]++;

      // Count by category
      const cat = risk.type;
      byCategory.set(cat, (byCategory.get(cat) ?? 0) + 1);

      // Weighted score
      totalWeightedScore += SEVERITY_WEIGHTS[risk.severity] ?? 0;
    }

    // Normalize to 0-100 scale (0 = no risk, 100 = extreme risk)
    const maxPossibleScore = risks.length * (SEVERITY_WEIGHTS['critical'] ?? 10);
    const overallRiskScore =
      maxPossibleScore > 0 ? Math.round((totalWeightedScore / maxPossibleScore) * 100) : 0;

    // Top risks sorted by severity
    const sortedRisks = [...risks].sort((a, b) => {
      return (SEVERITY_WEIGHTS[b.severity] ?? 0) - (SEVERITY_WEIGHTS[a.severity] ?? 0);
    });

    const topRisks = sortedRisks.slice(0, 10).map((risk) => ({
      riskId: risk.id,
      type: risk.type,
      severity: risk.severity,
      description: risk.description,
      affectedEntityCount: risk.affectedEntities.length,
    }));

    return {
      overallRiskScore,
      totalRisks: risks.length,
      bySeverity,
      topRisks,
      byCategory: Object.fromEntries(byCategory),
      computedAt: Date.now(),
    };
  }
}
