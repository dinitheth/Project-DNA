/**
 * RiskAggregator — Aggregates individual risk nodes into RiskAssessment.
 *
 * Computes total risk exposure, severity distribution, top risks,
 * and categorization from raw risk data.
 */

import type { Logger } from '@project-dna/shared';
import type { RiskNode, RiskAssessment } from '@project-dna/dna-core';
import { calculateRiskExposureScore, compareRiskExposure } from './risk-exposure.js';

export class RiskAggregator {
  constructor(private readonly logger: Logger) {}

  aggregate(risks: RiskNode[]): RiskAssessment {
    this.logger.info(`Aggregating ${risks.length} risks...`);

    const bySeverity = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    const byCategory = new Map<string, number>();

    for (const risk of risks) {
      // Count by severity
      const sev = risk.severity as keyof typeof bySeverity;
      if (sev in bySeverity) bySeverity[sev]++;

      // Count by category
      const cat = risk.type;
      byCategory.set(cat, (byCategory.get(cat) ?? 0) + 1);
    }

    const overallRiskScore = calculateRiskExposureScore(risks);

    const sortedRisks = [...risks].sort(compareRiskExposure);

    const topRisks = sortedRisks.slice(0, 10).map((risk) => ({
      riskId: risk.id,
      type: risk.type,
      severity: risk.severity,
      description: risk.description,
      affectedEntityCount: new Set(risk.affectedEntities).size,
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
