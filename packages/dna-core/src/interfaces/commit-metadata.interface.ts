import type { Result } from '@project-dna/shared';
import type { CommitChangedFile, CommitImpactRequest } from '../models/commit-impact.js';

export interface CommitMetadata {
  readonly commitSha: string;
  readonly treeSha: string;
  readonly parentCommits: readonly string[];
  readonly parentCommitSha: string | null;
  readonly parentTreeSha: string | null;
  readonly changedFiles: readonly CommitChangedFile[];
  readonly complete: boolean;
  readonly truncatedAt: number | null;
}

export interface ICommitMetadataProvider {
  getCommitMetadata(
    rootPath: string,
    request: CommitImpactRequest,
    options?: { readonly maxChangedFiles?: number },
    signal?: AbortSignal,
  ): Promise<Result<CommitMetadata>>;
}
