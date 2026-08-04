import { describe, expect, it } from 'vitest';
import { RiskNodeSchema } from '@project-dna/dna-core';
import { createSilentLogger } from '@project-dna/shared';
import { HealthAnalyzer } from '../analyzers/health-analyzer.js';
import { RiskAggregator } from '../analyzers/risk-aggregator.js';

describe('risk exposure aggregation', () => {
  it('increases with total severity exposure and affected entity count', () => {
    const aggregator = new RiskAggregator(createSilentLogger());
    const oneLow = aggregator.aggregate([risk('low', ['file:a'])]);
    const twoLow = aggregator.aggregate([risk('low', ['file:a']), risk('low', ['file:b'])]);
    const wideCritical = aggregator.aggregate([risk('critical', ['file:a', 'file:b', 'file:c'])]);

    expect(oneLow.overallRiskScore).toBe(8);
    expect(twoLow.overallRiskScore).toBe(15);
    expect(wideCritical.overallRiskScore).toBe(70);
    expect(twoLow.overallRiskScore).toBeGreaterThan(oneLow.overallRiskScore);
    expect(wideCritical.overallRiskScore).toBeGreaterThan(oneLow.overallRiskScore);
  });

  it('counts each affected entity once in both exposure and displayed impact', () => {
    const assessment = new RiskAggregator(createSilentLogger()).aggregate([
      risk('high', ['file:a', 'file:a']),
    ]);

    expect(assessment.overallRiskScore).toBe(24);
    expect(assessment.topRisks[0]?.affectedEntityCount).toBe(1);
  });

  it('uses the same exposure semantics for repository risk health', () => {
    const risks = [risk('high', ['file:a', 'file:b'])];
    const assessment = new RiskAggregator(createSilentLogger()).aggregate(risks);
    const health = new HealthAnalyzer(createSilentLogger()).compute(
      [entity('file:a'), entity('file:b')],
      architecture(),
      [],
      risks,
    );

    expect(health.dimensions.riskHealth).toBe(100 - assessment.overallRiskScore);
  });
});

function risk(severity: 'low' | 'high' | 'critical', affectedEntities: string[]) {
  return RiskNodeSchema.parse({
    id: `risk:${severity}:${affectedEntities.join(',')}`,
    type: 'high-complexity',
    severity,
    affectedEntities,
    description: severity,
    detectedAt: 1,
  });
}

function entity(id: string) {
  return {
    id,
    kind: 'file' as const,
    name: id,
    path: id,
    purpose: id,
    architectureRole: 'unknown' as const,
    businessDomain: null,
    importance: 0.5,
    criticality: 'medium' as const,
    complexity: 1,
    healthScore: 1,
    risks: [],
    dependsOn: [],
    dependedOnBy: [],
    belongsToDomain: null,
    belongsToLayer: null,
    knowledgeNodeIds: [],
    knowledgeDensity: 0,
    confidence: 0.7,
    lastAnalyzedAt: 1,
  };
}

function architecture() {
  return {
    id: 'architecture',
    pattern: 'unknown' as const,
    confidence: 0,
    detectedPatterns: [],
    layers: [],
    evidence: [],
    detectedAt: 1,
  };
}
