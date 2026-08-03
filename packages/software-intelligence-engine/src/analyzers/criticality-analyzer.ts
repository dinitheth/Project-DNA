/**
 * CriticalityAnalyzer — Identifies critical components via multi-factor scoring.
 *
 * Uses graph centrality, fan-in/fan-out, complexity, and file size
 * to determine which entities have the highest blast radius.
 */

import type { Logger } from '@project-dna/shared';
import type { DNAObject, CriticalComponent, CriticalityLevel } from '@project-dna/dna-core';

export class CriticalityAnalyzer {
  constructor(private readonly logger: Logger) {}

  identify(entities: DNAObject[]): CriticalComponent[] {
    this.logger.info('Identifying critical components...');

    if (entities.length === 0) return [];

    // Compute normalization bounds
    const maxFanIn = Math.max(...entities.map((e) => e.dependedOnBy.length), 1);
    const maxFanOut = Math.max(...entities.map((e) => e.dependsOn.length), 1);
    const maxComplexity = Math.max(...entities.map((e) => e.complexity), 1);

    const scored = entities.map((entity) => {
      const fanInScore = entity.dependedOnBy.length / maxFanIn;
      const fanOutScore = entity.dependsOn.length / maxFanOut;
      const complexityScore = entity.complexity / maxComplexity;
      const centralityScore = entity.importance;
      const sizeScore = 0.5; // Would need LOC data for real sizing

      // Weighted composite score
      const score =
        centralityScore * 0.3 +
        fanInScore * 0.25 +
        fanOutScore * 0.15 +
        complexityScore * 0.2 +
        sizeScore * 0.1;

      return {
        entity,
        score,
        factors: {
          centrality: centralityScore,
          fanIn: fanInScore,
          fanOut: fanOutScore,
          complexity: complexityScore,
          size: sizeScore,
        },
      };
    });

    // Sort by score descending and take critical/high
    scored.sort((a, b) => b.score - a.score);

    const results: CriticalComponent[] = [];
    for (const { entity, score, factors } of scored) {
      const criticality = this.classifyCriticality(score);
      if (criticality === 'low') continue; // Only report medium+ criticality

      results.push({
        id: `critical:${entity.id}`,
        entityId: entity.id,
        name: entity.name,
        path: entity.path,
        criticality,
        score: Math.round(score * 1000) / 1000,
        factors: {
          centrality: Math.round(factors.centrality * 1000) / 1000,
          fanIn: Math.round(factors.fanIn * 1000) / 1000,
          fanOut: Math.round(factors.fanOut * 1000) / 1000,
          complexity: Math.round(factors.complexity * 1000) / 1000,
          size: Math.round(factors.size * 1000) / 1000,
        },
        reason: this.generateReason(entity, factors, criticality),
        associatedRiskIds: entity.risks,
        identifiedAt: Date.now(),
      });
    }

    this.logger.info(`Identified ${results.length} critical/high/medium components`);
    return results;
  }

  private classifyCriticality(score: number): CriticalityLevel {
    if (score >= 0.8) return 'critical';
    if (score >= 0.6) return 'high';
    if (score >= 0.3) return 'medium';
    return 'low';
  }

  private generateReason(
    entity: DNAObject,
    factors: Record<string, number>,
    criticality: CriticalityLevel,
  ): string {
    const reasons: string[] = [];

    if ((factors.fanIn ?? 0) > 0.7) {
      reasons.push(`high fan-in (${entity.dependedOnBy.length} dependents)`);
    }
    if ((factors.complexity ?? 0) > 0.7) {
      reasons.push(`high complexity (${entity.complexity})`);
    }
    if ((factors.centrality ?? 0) > 0.7) {
      reasons.push('high graph centrality');
    }
    if ((factors.fanOut ?? 0) > 0.7) {
      reasons.push(`high fan-out (${entity.dependsOn.length} dependencies)`);
    }

    if (reasons.length === 0) {
      return `${criticality} criticality based on composite scoring`;
    }

    return `${criticality} criticality due to ${reasons.join(', ')}`;
  }
}
