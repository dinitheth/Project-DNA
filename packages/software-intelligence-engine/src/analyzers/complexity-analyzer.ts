/**
 * ComplexityAnalyzer — Computes the ComplexityProfile from entity data.
 *
 * Measures cyclomatic complexity distribution, nesting depth,
 * coupling metrics, and instability indices.
 */

import type { Logger } from '@project-dna/shared';
import type { DNAObject, ComplexityProfile } from '@project-dna/dna-core';

export class ComplexityAnalyzer {
  constructor(private readonly logger: Logger) {}

  compute(entities: DNAObject[]): ComplexityProfile {
    this.logger.info('Computing complexity profile...');

    const complexities = entities.map((e) => e.complexity);
    const avgComplexity = complexities.length > 0
      ? complexities.reduce((sum, c) => sum + c, 0) / complexities.length
      : 0;
    const maxComplexity = complexities.length > 0
      ? Math.max(...complexities)
      : 0;

    const mostComplexEntity = entities.reduce<DNAObject | null>(
      (max, e) => (!max || e.complexity > max.complexity ? e : max),
      null,
    );

    const distribution = this.computeDistribution(complexities);
    const couplingMetrics = this.computeCouplingMetrics(entities);

    const highComplexityFiles = complexities.filter((c) => c > 15).length;
    const complexCodePercentage = complexities.length > 0
      ? (highComplexityFiles / complexities.length) * 100
      : 0;

    return {
      averageComplexity: Math.round(avgComplexity * 100) / 100,
      maxComplexity,
      mostComplexFile: mostComplexEntity?.path ?? null,
      distribution,
      averageNestingDepth: 0, // Would require AST nesting data
      maxNestingDepth: 0,
      complexCodePercentage: Math.round(complexCodePercentage * 10) / 10,
      averageAfferentCoupling: couplingMetrics.avgAfferent,
      averageEfferentCoupling: couplingMetrics.avgEfferent,
      averageInstability: couplingMetrics.avgInstability,
      computedAt: Date.now(),
    };
  }

  private computeDistribution(complexities: number[]): {
    low: number;
    medium: number;
    high: number;
    critical: number;
  } {
    let low = 0, medium = 0, high = 0, critical = 0;
    for (const c of complexities) {
      if (c <= 5) low++;
      else if (c <= 15) medium++;
      else if (c <= 30) high++;
      else critical++;
    }
    return { low, medium, high, critical };
  }

  private computeCouplingMetrics(entities: DNAObject[]): {
    avgAfferent: number;
    avgEfferent: number;
    avgInstability: number;
  } {
    if (entities.length === 0) {
      return { avgAfferent: 0, avgEfferent: 0, avgInstability: 0 };
    }

    let totalAfferent = 0;
    let totalEfferent = 0;
    let totalInstability = 0;

    for (const entity of entities) {
      const ca = entity.dependedOnBy.length; // Afferent coupling
      const ce = entity.dependsOn.length;    // Efferent coupling
      totalAfferent += ca;
      totalEfferent += ce;

      const total = ca + ce;
      totalInstability += total > 0 ? ce / total : 0;
    }

    return {
      avgAfferent: Math.round((totalAfferent / entities.length) * 100) / 100,
      avgEfferent: Math.round((totalEfferent / entities.length) * 100) / 100,
      avgInstability: Math.round((totalInstability / entities.length) * 100) / 100,
    };
  }
}
