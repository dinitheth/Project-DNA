import type { Result } from '@project-dna/shared';
import type {
  CommitImpactOptions,
  CommitImpactRequest,
  CommitImpactResult,
} from '../models/commit-impact.js';

export interface IProjectDNACommitImpact {
  getCommitImpact(
    request: CommitImpactRequest,
    options?: CommitImpactOptions,
    signal?: AbortSignal,
  ): Promise<Result<CommitImpactResult>>;
}
