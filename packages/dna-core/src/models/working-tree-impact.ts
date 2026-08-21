import { z } from 'zod';
import { AnalysisChangeSetSchema } from './analysis-change-set.js';
import { ImpactResultSchema } from './impact.js';

const NormalizedRelativePathSchema = z
  .string()
  .min(1)
  .refine((value) => !value.startsWith('/') && !/^[A-Za-z]:/u.test(value), {
    message: 'Working-tree paths must be repository-relative',
  })
  .refine((value) => !value.split('/').includes('..'), {
    message: 'Working-tree paths must not traverse parent directories',
  });

export const WorkingTreeChangeKindSchema = z.enum([
  'added',
  'modified',
  'deleted',
  'renamed',
  'type-changed',
]);
export type WorkingTreeChangeKind = z.infer<typeof WorkingTreeChangeKindSchema>;

export const WorkingTreeContentKindSchema = z.enum([
  'text',
  'binary',
  'symlink',
  'submodule',
  'unknown',
]);
export type WorkingTreeContentKind = z.infer<typeof WorkingTreeContentKindSchema>;

export const WorkingTreeChangedPathSchema = z.object({
  kind: WorkingTreeChangeKindSchema,
  path: NormalizedRelativePathSchema,
  previousPath: NormalizedRelativePathSchema.optional(),
  staged: z.boolean(),
  unstaged: z.boolean(),
  untracked: z.boolean(),
  contentKind: WorkingTreeContentKindSchema,
});
export type WorkingTreeChangedPath = Readonly<z.infer<typeof WorkingTreeChangedPathSchema>>;

export const WorkingTreeTruncationSchema = z.object({
  kind: z.enum(['max-changed-paths', 'max-targets', 'max-impacted-entities']),
  limit: z.number().int().positive(),
});
export type WorkingTreeTruncation = Readonly<z.infer<typeof WorkingTreeTruncationSchema>>;

export const WorkingTreeChangeSetSchema = z.object({
  headCommit: z.string().regex(/^[0-9a-f]{4,}$/u),
  gitVersion: z.string().min(1),
  changes: z.array(WorkingTreeChangedPathSchema),
  changeSetFingerprint: z.string().regex(/^[0-9a-f]{64}$/u),
  contentFingerprint: z.string().regex(/^[0-9a-f]{64}$/u),
  complete: z.boolean(),
  truncations: z.array(WorkingTreeTruncationSchema),
});
export type WorkingTreeChangeSet = Readonly<z.infer<typeof WorkingTreeChangeSetSchema>>;

export const WorkingTreeImpactOptionsSchema = z.object({
  maxChangedPaths: z.number().int().positive().max(10_000).default(500),
  maxTargets: z.number().int().positive().max(500).default(100),
  maxImpactedEntities: z.number().int().positive().max(5_000).default(5_000),
});
export type WorkingTreeImpactOptions = z.input<typeof WorkingTreeImpactOptionsSchema>;

export const WorkingTreeImpactTargetSchema = z.object({
  path: NormalizedRelativePathSchema,
  previousPath: NormalizedRelativePathSchema.optional(),
  side: z.enum(['before', 'after']),
  entityId: z.string().min(1),
  sourceAvailable: z.boolean(),
});
export type WorkingTreeImpactTarget = Readonly<z.infer<typeof WorkingTreeImpactTargetSchema>>;

export const WorkingTreeUnresolvedPathSchema = z.object({
  path: NormalizedRelativePathSchema,
  previousPath: NormalizedRelativePathSchema.optional(),
  side: z.enum(['before', 'after']),
  reason: z.enum([
    'analysis-refresh-required',
    'clean-baseline-unavailable',
    'legacy-analysis-state-unavailable',
    'non-analyzable',
    'missing-entity',
  ]),
});
export type WorkingTreeUnresolvedPath = Readonly<z.infer<typeof WorkingTreeUnresolvedPathSchema>>;

export const WorkingTreeImpactEntrySchema = z.object({
  path: NormalizedRelativePathSchema,
  side: z.enum(['before', 'after']),
  result: ImpactResultSchema,
});
export type WorkingTreeImpactEntry = Readonly<z.infer<typeof WorkingTreeImpactEntrySchema>>;

export const WorkingTreeImpactProvenanceSchema = z.object({
  headCommit: z.string().regex(/^[0-9a-f]{4,}$/u),
  gitVersion: z.string().min(1),
  changeSetFingerprint: z.string().regex(/^[0-9a-f]{64}$/u),
  contentFingerprint: z.string().regex(/^[0-9a-f]{64}$/u),
});
export type WorkingTreeImpactProvenance = Readonly<
  z.infer<typeof WorkingTreeImpactProvenanceSchema>
>;

export const WorkingTreeImpactResultSchema = z.object({
  repositoryId: z.string().min(1),
  headCommit: z.string().regex(/^[0-9a-f]{4,}$/u),
  changedPaths: z.array(WorkingTreeChangedPathSchema),
  resolvedTargets: z.array(WorkingTreeImpactTargetSchema),
  unresolvedPaths: z.array(WorkingTreeUnresolvedPathSchema),
  impacts: z.array(WorkingTreeImpactEntrySchema),
  changedEntityIds: z.array(z.string()),
  impactedEntityIds: z.array(z.string()),
  changeSet: AnalysisChangeSetSchema.nullable(),
  provenance: WorkingTreeImpactProvenanceSchema,
  beforeAnalysisVersion: z.number().int().nonnegative().nullable(),
  afterAnalysisVersion: z.number().int().nonnegative().nullable(),
  warnings: z.array(z.string()),
  complete: z.boolean(),
  truncations: z.array(WorkingTreeTruncationSchema),
});
export type WorkingTreeImpactResult = Readonly<z.infer<typeof WorkingTreeImpactResultSchema>>;
