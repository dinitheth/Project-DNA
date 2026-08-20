import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AnalysisChangeSetSchema } from './analysis-change-set.js';
import { CommitChangedFileSchema, CommitFileContentKindSchema } from './commit-impact.js';
import { ImpactResultSchema } from './impact.js';

const Sha = z.string().regex(/^[0-9a-f]{40}$/u, 'Expected a full lowercase commit SHA');
const Digest = z.string().regex(/^[0-9a-f]{64}$/u);
const RelativePath = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !value.startsWith('/') &&
      !value.startsWith('\\') &&
      !/^[A-Za-z]:/u.test(value) &&
      !value.split(/[\\/]/u).includes('..') &&
      !value.includes('\0'),
    'Path must be repository-relative',
  );

export const PullRequestImpactRequestSchema = z.object({ baseSha: Sha, headSha: Sha });
export type PullRequestImpactRequest = Readonly<z.infer<typeof PullRequestImpactRequestSchema>>;

export const PullRequestImpactOptionsSchema = z.object({
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
export type PullRequestImpactOptions = z.input<typeof PullRequestImpactOptionsSchema>;

export const PullRequestAnalysisProvenanceSchema = z.object({
  kind: z.literal('git-pull-request'),
  repositoryId: z.string().min(1),
  baseCommitSha: Sha,
  headCommitSha: Sha,
  baseTreeSha: Sha,
  headTreeSha: Sha,
  mergeBaseSha: Sha.nullable(),
  analysisConfigFingerprint: Digest,
  baseContentFingerprint: Digest,
  headContentFingerprint: Digest,
  gitVersion: z.string().min(1),
  renameDetectionPolicy: z.string().min(1),
  beforeSource: z.enum(['persisted', 'materialized']),
  afterSource: z.enum(['persisted', 'materialized']),
  changedFileFingerprint: Digest,
  requestFingerprint: Digest,
});
export type PullRequestAnalysisProvenance = Readonly<
  z.infer<typeof PullRequestAnalysisProvenanceSchema>
>;

export const PullRequestImpactEntrySchema = z.object({
  side: z.enum(['before', 'after']),
  path: RelativePath,
  previousPath: RelativePath.optional(),
  entityId: z.string().min(1),
  sourceAvailable: z.boolean(),
  result: ImpactResultSchema,
});
export type PullRequestImpactEntry = Readonly<z.infer<typeof PullRequestImpactEntrySchema>>;

export const PullRequestImpactSummarySchema = z.object({
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
export type PullRequestImpactSummary = Readonly<z.infer<typeof PullRequestImpactSummarySchema>>;

export const PullRequestImpactTruncationSchema = z.object({
  kind: z.enum(['max-changed-files', 'max-targets', 'max-impacted-entities']),
  limit: z.number().int().positive(),
});

export const PullRequestImpactResultSchema = z.object({
  repositoryId: z.string().min(1),
  baseCommitSha: Sha,
  headCommitSha: Sha,
  baseTreeSha: Sha,
  headTreeSha: Sha,
  mergeBaseSha: Sha.nullable(),
  changedFiles: z.array(CommitChangedFileSchema).max(10_000),
  beforeProvenance: PullRequestAnalysisProvenanceSchema,
  afterProvenance: PullRequestAnalysisProvenanceSchema,
  changeSet: AnalysisChangeSetSchema.nullable(),
  impacts: z.array(PullRequestImpactEntrySchema).max(500),
  summary: PullRequestImpactSummarySchema,
  warnings: z.array(z.string()).max(100),
  complete: z.boolean(),
  unresolved: z
    .array(
      z.object({
        side: z.enum(['before', 'after']),
        path: RelativePath,
        previousPath: RelativePath.optional(),
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
  truncations: z.array(PullRequestImpactTruncationSchema).max(20),
});
export type PullRequestImpactResult = Readonly<z.infer<typeof PullRequestImpactResultSchema>>;

export interface PullRequestTreeRangeMetadata {
  readonly repositoryId?: string;
  readonly baseCommitSha: string;
  readonly headCommitSha: string;
  readonly baseTreeSha: string;
  readonly headTreeSha: string;
  readonly mergeBaseSha: string | null;
  readonly changedFiles: readonly z.infer<typeof CommitChangedFileSchema>[];
  readonly gitVersion: string;
  readonly renameDetectionPolicy: string;
  readonly changedFileFingerprint: string;
  readonly requestFingerprint: string;
  readonly complete: boolean;
  readonly truncatedAt: number | null;
}

export function pullRequestRequestFingerprint(request: PullRequestImpactRequest): string {
  return createHash('sha256').update(`${request.baseSha}\0${request.headSha}`).digest('hex');
}

export type PullRequestContentKind = z.infer<typeof CommitFileContentKindSchema>;
