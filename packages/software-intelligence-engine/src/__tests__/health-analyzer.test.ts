import { describe, expect, it } from 'vitest';
import {
  ArchitectureDNASchema,
  DNAObjectSchema,
  RiskNodeSchema,
  KnowledgeNodeSchema,
  type RiskNode,
} from '@project-dna/dna-core';
import { createSilentLogger } from '@project-dna/shared';
import { HealthAnalyzer } from '../analyzers/health-analyzer.js';

describe('HealthAnalyzer data integrity', () => {
  it('returns unavailable zero scores when no entities were parsed', () => {
    const health = new HealthAnalyzer(createSilentLogger()).compute([], architecture(), [], []);

    expect(health.overallScore).toBe(0);
    expect(Object.values(health.dimensions)).toEqual([0, 0, 0, 0, 0]);
    expect(health.trend).toBe('unknown');
  });

  it('uses risk severity when computing the risk health signal', () => {
    const analyzer = new HealthAnalyzer(createSilentLogger());
    const lowRiskHealth = analyzer.compute([entity()], architecture(), [], [risk('low')]);
    const criticalRiskHealth = analyzer.compute([entity()], architecture(), [], [risk('critical')]);

    expect(criticalRiskHealth.dimensions.riskHealth).toBeLessThan(
      lowRiskHealth.dimensions.riskHealth,
    );
  });

  it('excludes repository-level knowledge from entity knowledge density', () => {
    const analyzer = new HealthAnalyzer(createSilentLogger());
    const repositoryKnowledge = KnowledgeNodeSchema.parse({
      id: 'knowledge:repository',
      type: 'metric',
      name: 'Repository architecture',
      metadata: {},
      relationships: [],
      tags: ['architecture'],
      sourceRef: 'C:/repo',
      createdAt: 1,
    });
    const entityKnowledge = KnowledgeNodeSchema.parse({
      ...repositoryKnowledge,
      id: 'knowledge:entity',
      sourceRef: 'src/index.ts',
    });

    const repositoryOnly = analyzer.compute([entity()], architecture(), [repositoryKnowledge], []);
    const entityAttributed = analyzer.compute([entity()], architecture(), [entityKnowledge], []);

    expect(repositoryOnly.dimensions.knowledgeHealth).toBe(0);
    expect(entityAttributed.dimensions.knowledgeHealth).toBe(20);
  });
});

function architecture() {
  return ArchitectureDNASchema.parse({
    id: 'architecture-id',
    pattern: 'unknown',
    confidence: 0,
    detectedPatterns: [],
    layers: [],
    evidence: [],
    detectedAt: 1,
  });
}

function entity() {
  return DNAObjectSchema.parse({
    id: 'file:src/index.ts',
    kind: 'file',
    name: 'index.ts',
    path: 'src/index.ts',
    purpose: 'Entry point',
    architectureRole: 'entry-point',
    businessDomain: null,
    importance: 0.5,
    criticality: 'medium',
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
  });
}

function risk(severity: RiskNode['severity']): RiskNode {
  return RiskNodeSchema.parse({
    id: `risk:${severity}`,
    type: 'high-complexity',
    severity,
    affectedEntities: ['src/index.ts'],
    description: `${severity} risk`,
    detectedAt: 1,
  });
}
