import { z } from 'zod';
import { ArchitectureLayerSchema } from './architecture-dna.js';
import { BusinessDomainSchema } from './business-domain.js';
import { CapabilitySchema } from './capability.js';
import { CriticalComponentSchema } from './critical-component.js';
import { RiskNodeSchema } from './risk-node.js';

const SafeNonnegativeIntegerSchema = z
  .number()
  .int()
  .nonnegative()
  .refine(Number.isSafeInteger, 'Expected a safe nonnegative integer');

const SafePositiveIntegerSchema = z
  .number()
  .int()
  .positive()
  .refine(Number.isSafeInteger, 'Expected a safe positive integer');

export const ImpactTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('file'), path: z.string().min(1) }),
  z.object({ kind: z.literal('entity'), id: z.string().min(1) }),
]);
export type ImpactTarget = z.infer<typeof ImpactTargetSchema>;

export const DEFAULT_IMPACT_BOUNDS = {
  maxDepth: 8,
  maxEntities: 500,
  maxEvidencePaths: 1,
} as const;

export const HARD_IMPACT_BOUNDS = {
  maxDepth: 32,
  maxEntities: 5_000,
  maxEvidencePaths: 3,
} as const;

export const ImpactOptionsSchema = z
  .object({
    maxDepth: SafeNonnegativeIntegerSchema.default(DEFAULT_IMPACT_BOUNDS.maxDepth),
    maxEntities: SafePositiveIntegerSchema.default(DEFAULT_IMPACT_BOUNDS.maxEntities),
    maxEvidencePaths: SafePositiveIntegerSchema.default(DEFAULT_IMPACT_BOUNDS.maxEvidencePaths),
  })
  .superRefine((value, context) => {
    for (const [key, maximum] of Object.entries(HARD_IMPACT_BOUNDS)) {
      const configured = value[key as keyof typeof HARD_IMPACT_BOUNDS];
      if (configured > maximum) {
        context.addIssue({
          code: z.ZodIssueCode.too_big,
          maximum,
          type: 'number',
          inclusive: true,
          path: [key],
          message: `${key} cannot exceed ${maximum}`,
        });
      }
    }
  });
export type ImpactOptions = z.infer<typeof ImpactOptionsSchema>;

export const ImpactRelationshipTypeSchema = z.enum([
  'import',
  're-export',
  'dynamic-import',
  'require',
  'type-import',
]);

export const ImpactRelationshipSchema = z.object({
  /** The importer/dependent at the source of the stored edge. */
  dependentId: z.string().min(1),
  /** The imported dependency at the target of the stored edge. */
  dependencyId: z.string().min(1),
  type: ImpactRelationshipTypeSchema,
  isTypeOnly: z.boolean(),
  specifierCount: SafeNonnegativeIntegerSchema,
});
export type ImpactRelationship = z.infer<typeof ImpactRelationshipSchema>;

export const ImpactNodeSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('file'),
  name: z.string().min(1),
  path: z.string().nullable(),
  minimumDepth: SafeNonnegativeIntegerSchema,
});
export type ImpactNode = z.infer<typeof ImpactNodeSchema>;

export const ImpactPathSchema = z
  .object({
    impactedEntityId: z.string().min(1),
    /** IDs are ordered in propagation direction: target, dependent, ... impacted entity. */
    nodeIds: z.array(z.string().min(1)).min(2),
    relationships: z.array(ImpactRelationshipSchema),
  })
  .superRefine((value, context) => {
    if (value.relationships.length !== value.nodeIds.length - 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['relationships'],
        message: 'Impact paths must contain exactly one relationship between adjacent nodes',
      });
    }
    if (value.nodeIds.at(-1) !== value.impactedEntityId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['impactedEntityId'],
        message: 'Impact path must end at the impacted entity',
      });
    }
    value.relationships.forEach((relationship, index) => {
      if (
        relationship.dependencyId !== value.nodeIds[index] ||
        relationship.dependentId !== value.nodeIds[index + 1]
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['relationships', index],
          message: 'Impact path relationships must connect adjacent nodes in propagation order',
        });
      }
    });
  });
export type ImpactPath = z.infer<typeof ImpactPathSchema>;

export const ImpactEvidenceReasonSchema = z.enum([
  'direct-dependent',
  'transitive-dependent',
  'domain-membership',
  'capability-implementation',
  'critical-component',
  'risk-reference',
  'architecture-layer-membership',
  'layer-boundary',
]);

export const ImpactEvidenceSchema = z.object({
  id: z.string().min(1),
  entityId: z.string().min(1),
  reason: ImpactEvidenceReasonSchema,
  path: ImpactPathSchema.nullable(),
  sourcePath: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});
export type ImpactEvidence = z.infer<typeof ImpactEvidenceSchema>;

export const ImpactScoreComponentKindSchema = z.enum([
  'dependency-reach',
  'critical-component-exposure',
  'domain-reach',
  'risk-exposure',
  'architecture-boundaries',
]);

export const ImpactScoreComponentSchema = z.object({
  kind: ImpactScoreComponentKindSchema,
  rawInput: z.number().nonnegative(),
  normalizedValue: z.number().min(0).max(1),
  weight: z.number().min(0).max(1),
  contribution: z.number().min(0).max(100),
  evidenceIds: z.array(z.string().min(1)),
});
export type ImpactScoreComponent = z.infer<typeof ImpactScoreComponentSchema>;

export const ImpactScoreSchema = z
  .object({
    total: z.number().min(0).max(100),
    components: z.array(ImpactScoreComponentSchema).length(5),
  })
  .superRefine((value, context) => {
    const kinds = new Set(value.components.map((component) => component.kind));
    for (const kind of ImpactScoreComponentKindSchema.options) {
      if (!kinds.has(kind)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['components'],
          message: `Impact score must contain the ${kind} component exactly once`,
        });
      }
    }
  });
export type ImpactScore = z.infer<typeof ImpactScoreSchema>;

export const ImpactTruncationKindSchema = z.enum([
  'max-depth',
  'max-entities',
  'max-evidence-paths',
]);

export const ImpactTruncationSchema = z.object({
  kind: ImpactTruncationKindSchema,
  limit: SafeNonnegativeIntegerSchema,
  atEntityId: z.string().nullable(),
});
export type ImpactTruncation = z.infer<typeof ImpactTruncationSchema>;

export const ImpactBoundsSchema = z.object({
  maxDepth: SafeNonnegativeIntegerSchema,
  maxEntities: SafePositiveIntegerSchema,
  maxEvidencePaths: SafePositiveIntegerSchema,
});
export type ImpactBounds = z.infer<typeof ImpactBoundsSchema>;

const ImpactBoundaryCrossingSchema = z.object({
  fromLayer: z.string().min(1),
  toLayer: z.string().min(1),
  dependentId: z.string().min(1),
  dependencyId: z.string().min(1),
});

export const ImpactSemanticEffectsSchema = z.object({
  domains: z.array(BusinessDomainSchema),
  capabilities: z.array(CapabilitySchema),
  criticalComponents: z.array(CriticalComponentSchema),
  risks: z.array(RiskNodeSchema),
  architecture: z.object({
    layers: z.array(ArchitectureLayerSchema),
    boundaryCrossings: z.array(ImpactBoundaryCrossingSchema),
  }),
});
export type ImpactSemanticEffects = z.infer<typeof ImpactSemanticEffectsSchema>;

export const ImpactResultSchema = z
  .object({
    repositoryId: z.string().min(1),
    analysisVersion: SafeNonnegativeIntegerSchema,
    target: ImpactNodeSchema,
    directImpactedEntities: z.array(ImpactNodeSchema),
    transitiveImpactedEntities: z.array(ImpactNodeSchema),
    minimumDepth: SafeNonnegativeIntegerSchema.nullable(),
    canonicalPaths: z.array(ImpactPathSchema),
    semanticEffects: ImpactSemanticEffectsSchema,
    score: ImpactScoreSchema,
    evidence: z.array(ImpactEvidenceSchema),
    warnings: z.array(z.string()),
    complete: z.boolean(),
    truncations: z.array(ImpactTruncationSchema),
    appliedBounds: ImpactBoundsSchema,
  })
  .superRefine((value, context) => {
    if (value.complete === value.truncations.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['complete'],
        message: 'Complete impact results must not contain truncations',
      });
    }
  });
export type ImpactResult = z.infer<typeof ImpactResultSchema>;
