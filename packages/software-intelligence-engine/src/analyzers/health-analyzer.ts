/**
 * HealthAnalyzer — Computes the composite RepositoryHealth score.
 *
 * Evaluates 5 dimensions entirely through deterministic heuristics:
 * architecture health, dependency health, complexity health,
 * knowledge health, and risk health.
 */

import type { Logger } from '@project-dna/shared';
import {
  createRepositoryHealth,
  type DNAObject,
  type ArchitectureDNA,
  type KnowledgeNode,
  type RiskNode,
  type RepositoryHealth,
} from '@project-dna/dna-core';
import { calculateRiskExposureScore } from './risk-exposure.js';

export class HealthAnalyzer {
  constructor(private readonly logger: Logger) {}

  compute(
    entities: DNAObject[],
    architecture: ArchitectureDNA,
    knowledgeNodes: KnowledgeNode[],
    risks: RiskNode[] = [],
  ): RepositoryHealth {
    this.logger.info('Computing repository health...');
    const health = createRepositoryHealth({
      entities,
      architecture,
      knowledgeNodes,
      riskExposureScore: calculateRiskExposureScore(risks),
    });
    this.logger.info(`Health computed: ${health.overallScore}/100`);
    return health;
  }
}
