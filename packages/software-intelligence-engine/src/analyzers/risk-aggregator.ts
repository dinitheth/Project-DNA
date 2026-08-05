/**
 * RiskAggregator — Aggregates individual risk nodes into RiskAssessment.
 *
 * Computes total risk exposure, severity distribution, top risks,
 * and categorization from raw risk data.
 */

import type { Logger } from '@project-dna/shared';
import { createRiskAssessment, type RiskNode, type RiskAssessment } from '@project-dna/dna-core';

export class RiskAggregator {
  constructor(private readonly logger: Logger) {}

  aggregate(risks: RiskNode[]): RiskAssessment {
    this.logger.info(`Aggregating ${risks.length} risks...`);
    return createRiskAssessment(risks);
  }
}
