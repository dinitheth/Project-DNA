import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IMPACT_BOUNDS,
  HARD_IMPACT_BOUNDS,
  ImpactNodeSchema,
  ImpactOptionsSchema,
  ImpactResultSchema,
  ImpactScoreSchema,
  ImpactTargetSchema,
} from '../index.js';

describe('impact contracts', () => {
  it('applies bounded defaults and accepts the hard limits', () => {
    expect(ImpactOptionsSchema.parse({})).toEqual(DEFAULT_IMPACT_BOUNDS);
    expect(ImpactOptionsSchema.parse(HARD_IMPACT_BOUNDS)).toEqual(HARD_IMPACT_BOUNDS);
  });

  it('rejects unsafe or over-limit option values', () => {
    expect(() => ImpactOptionsSchema.parse({ maxDepth: Number.MAX_SAFE_INTEGER + 1 })).toThrow(
      /safe nonnegative integer|cannot exceed/u,
    );
    expect(() =>
      ImpactOptionsSchema.parse({ maxEntities: HARD_IMPACT_BOUNDS.maxEntities + 1 }),
    ).toThrow('maxEntities cannot exceed 5000');
    expect(() => ImpactOptionsSchema.parse({ maxEvidencePaths: 0 })).toThrow(
      'Number must be greater than 0',
    );
  });

  it('keeps the current impact boundary file-only', () => {
    expect(() =>
      ImpactNodeSchema.parse({
        id: 'class:PaymentService',
        kind: 'class',
        name: 'PaymentService',
        path: 'src/payment-service.ts',
        minimumDepth: 0,
      }),
    ).toThrow();
  });

  it('requires every score component exactly once', () => {
    expect(() =>
      ImpactScoreSchema.parse({
        total: 0,
        components: [
          'dependency-reach',
          'dependency-reach',
          'domain-reach',
          'risk-exposure',
          'architecture-boundaries',
        ].map((kind) => ({
          kind,
          rawInput: 0,
          normalizedValue: 0,
          weight: 0,
          contribution: 0,
          evidenceIds: [],
        })),
      }),
    ).toThrow('critical-component-exposure component exactly once');
  });

  it('validates canonical path shape and the complete result contract', () => {
    const result = ImpactResultSchema.parse({
      repositoryId: 'repo:fixture',
      analysisVersion: 1,
      target: {
        id: 'file:C.ts',
        kind: 'file',
        name: 'C.ts',
        path: 'C.ts',
        minimumDepth: 0,
      },
      directImpactedEntities: [],
      transitiveImpactedEntities: [
        {
          id: 'file:A.ts',
          kind: 'file',
          name: 'A.ts',
          path: 'A.ts',
          minimumDepth: 2,
        },
      ],
      minimumDepth: 1,
      canonicalPaths: [
        {
          impactedEntityId: 'file:A.ts',
          nodeIds: ['file:C.ts', 'file:B.ts', 'file:A.ts'],
          relationships: [
            {
              dependentId: 'file:B.ts',
              dependencyId: 'file:C.ts',
              type: 'import',
              isTypeOnly: false,
              specifierCount: 1,
            },
            {
              dependentId: 'file:A.ts',
              dependencyId: 'file:B.ts',
              type: 'type-import',
              isTypeOnly: true,
              specifierCount: 2,
            },
          ],
        },
      ],
      semanticEffects: {
        domains: [],
        capabilities: [],
        criticalComponents: [],
        risks: [],
        architecture: { layers: [], boundaryCrossings: [] },
      },
      score: {
        total: 0,
        components: [
          'dependency-reach',
          'critical-component-exposure',
          'domain-reach',
          'risk-exposure',
          'architecture-boundaries',
        ].map((kind) => ({
          kind,
          rawInput: 0,
          normalizedValue: 0,
          weight: 0,
          contribution: 0,
          evidenceIds: [],
        })),
      },
      evidence: [
        {
          id: 'evidence:file:A.ts:transitive-dependent',
          entityId: 'file:A.ts',
          reason: 'transitive-dependent',
          path: {
            impactedEntityId: 'file:A.ts',
            nodeIds: ['file:C.ts', 'file:B.ts', 'file:A.ts'],
            relationships: [
              {
                dependentId: 'file:B.ts',
                dependencyId: 'file:C.ts',
                type: 'import',
                isTypeOnly: false,
                specifierCount: 1,
              },
              {
                dependentId: 'file:A.ts',
                dependencyId: 'file:B.ts',
                type: 'type-import',
                isTypeOnly: true,
                specifierCount: 2,
              },
            ],
          },
          sourcePath: 'A.ts',
          confidence: 1,
        },
      ],
      warnings: [],
      complete: true,
      truncations: [],
      appliedBounds: DEFAULT_IMPACT_BOUNDS,
    });

    expect(result.target.id).toBe('file:C.ts');
    expect(result.canonicalPaths[0]?.relationships[1]?.isTypeOnly).toBe(true);
  });

  it('rejects unsupported target kinds and malformed paths', () => {
    expect(() =>
      ImpactTargetSchema.parse({
        kind: 'class',
        id: 'class:PaymentService',
      }),
    ).toThrow();

    expect(() =>
      ImpactResultSchema.parse({
        repositoryId: 'repo:fixture',
        analysisVersion: 1,
        target: {
          id: 'file:C.ts',
          kind: 'file',
          name: 'C.ts',
          path: 'C.ts',
          minimumDepth: 0,
        },
        directImpactedEntities: [],
        transitiveImpactedEntities: [],
        minimumDepth: null,
        canonicalPaths: [
          {
            impactedEntityId: 'file:A.ts',
            nodeIds: ['file:C.ts', 'file:A.ts'],
            relationships: [],
          },
        ],
      }),
    ).toThrow('exactly one relationship');
  });
});
