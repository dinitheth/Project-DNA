import { z } from 'zod';
import { AnalysisChangeSetSchema } from './analysis-change-set.js';
import { ImpactResultSchema } from './impact.js';

const FullCommitShaSchema = z
  .string()
  .regex(/^[0-9a-f]{40}$/u, 'Expected a full lowercase commit SHA');
const RelativePathSchema = z
  .string()
  .min(1)
  .refine(
    (value) => !value.startsWith('/') && !value.startsWith('\\') && !/^[A-Za-z]:/u.test(value),
    'Path must be relative',
  )
  .refine(
    (value) => !value.split(/[\\/]/u).includes('..'),
    'Path must not traverse parent directories',
  )
  .refine((value) => !value.includes('\0'), 'Path must not contain NUL bytes');

export const CommitImpactRequestSchema = z.object({
  commitSha: FullCommitShaSchema,
  parentSha: FullCommitShaSchema.optional(),
});
export type CommitImpactRequest = Readonly<z.infer<typeof CommitImpactRequestSchema>>;

export const CommitImpactOptionsSchema = z.object({
  maxChangedFiles: z.number().int().positive().max(10_000).default(500),
  maxTargets: z.number().int().positive().max(500).default(100),
  maxImpactedEntities: z.number().int().positive().max(5_000).default(5_000),
  maxArchiveBytes: z
    .number()
    .int()
    .positive()
    .max(512 * 1024 * 1024)
    .default(256 * 1024 * 1024),
  maxFiles: z.number().int().positive().max(100_000).default(50_000),
  maxExtractedBytes: z
    .number()
    .int()
    .positive()
    .max(1024 * 1024 * 1024)
    .default(512 * 1024 * 1024),
  maxFileBytes: z
    .number()
    .int()
    .positive()
    .max(256 * 1024 * 1024)
    .default(64 * 1024 * 1024),
});
export type CommitImpactOptions = z.input<typeof CommitImpactOptionsSchema>;

export const CommitChangeKindSchema = z.enum([
  'added',
  'modified',
  'deleted',
  'renamed',
  'type-changed',
]);
export type CommitChangeKind = z.infer<typeof CommitChangeKindSchema>;

export const CommitFileContentKindSchema = z.enum([
  'text',
  'binary',
  'symlink',
  'submodule',
  'unknown',
]);
export type CommitFileContentKind = z.infer<typeof CommitFileContentKindSchema>;

export const CommitChangedFileSchema = z.object({
  kind: CommitChangeKindSchema,
  path: RelativePathSchema,
  previousPath: RelativePathSchema.optional(),
  oldBlobSha: FullCommitShaSchema.nullable(),
  newBlobSha: FullCommitShaSchema.nullable(),
  oldMode: z
    .string()
    .regex(/^[0-7]{6}$/u)
    .nullable(),
  newMode: z
    .string()
    .regex(/^[0-7]{6}$/u)
    .nullable(),
  contentKind: CommitFileContentKindSchema,
  binary: z.boolean(),
  gitlink: z.boolean(),
});
export type CommitChangedFile = Readonly<z.infer<typeof CommitChangedFileSchema>>;

export const CommitAnalysisProvenanceSchema = z.object({
  kind: z.literal('git-commit'),
  repositoryId: z.string().min(1),
  commitSha: FullCommitShaSchema.nullable(),
  treeSha: FullCommitShaSchema,
  parentCommitSha: FullCommitShaSchema.nullable(),
  parentTreeSha: FullCommitShaSchema.nullable(),
  analysisConfigFingerprint: z.string().regex(/^[0-9a-f]{64}$/u),
  contentFingerprint: z.string().regex(/^[0-9a-f]{64}$/u),
  source: z.enum(['persisted', 'materialized']),
});
export type CommitAnalysisProvenance = Readonly<z.infer<typeof CommitAnalysisProvenanceSchema>>;

export const CommitImpactEntrySchema = z.object({
  side: z.enum(['before', 'after']),
  path: RelativePathSchema,
  previousPath: RelativePathSchema.optional(),
  entityId: z.string().min(1),
  sourceAvailable: z.boolean(),
  provenance: CommitAnalysisProvenanceSchema,
  result: ImpactResultSchema,
});
export type CommitImpactEntry = Readonly<z.infer<typeof CommitImpactEntrySchema>>;

export const CommitImpactSummarySchema = z.object({
  changedEntityIds: z.array(z.string()).max(5_000),
  impactedEntityIds: z.array(z.string()).max(5_000),
  directDependentIds: z.array(z.string()).max(5_000),
  transitiveDependentIds: z.array(z.string()).max(5_000),
  domainIds: z.array(z.string()).max(5_000),
  capabilityIds: z.array(z.string()).max(5_000),
  criticalComponentIds: z.array(z.string()).max(5_000),
  riskIds: z.array(z.string()).max(5_000),
  architectureLayers: z.array(z.string()).max(5_000),
  boundaryEvidence: z.array(z.string()).max(5_000),
  highestScore: z.number().min(0).max(100).nullable(),
});
export type CommitImpactSummary = Readonly<z.infer<typeof CommitImpactSummarySchema>>;

export const CommitImpactTruncationSchema = z.object({
  kind: z.enum(['max-changed-files', 'max-targets', 'max-impacted-entities', 'archive-limit']),
  limit: z.number().int().positive(),
});
export type CommitImpactTruncation = Readonly<z.infer<typeof CommitImpactTruncationSchema>>;

export const CommitImpactResultSchema = z.object({
  repositoryId: z.string().min(1),
  commitSha: FullCommitShaSchema,
  parentCommits: z.array(FullCommitShaSchema),
  parentCommitSha: FullCommitShaSchema.nullable(),
  changedFiles: z.array(CommitChangedFileSchema).max(10_000),
  before: CommitAnalysisProvenanceSchema,
  after: CommitAnalysisProvenanceSchema,
  changeSet: AnalysisChangeSetSchema.nullable(),
  impacts: z.array(CommitImpactEntrySchema).max(500),
  summary: CommitImpactSummarySchema,
  unresolved: z
    .array(
      z.object({
        side: z.enum(['before', 'after']),
        path: RelativePathSchema,
        reason: z.enum([
          'analysis-unavailable',
          'binary-not-analyzable',
          'symlink-not-analyzable',
          'submodule-not-analyzable',
          'missing-entity',
        ]),
      }),
    )
    .max(10_000),
  warnings: z.array(z.string()).max(100),
  complete: z.boolean(),
  truncations: z.array(CommitImpactTruncationSchema).max(20),
});
export type CommitImpactResult = Readonly<z.infer<typeof CommitImpactResultSchema>>;
