import type { Result } from '@project-dna/shared';
import type {
  PullRequestImpactRequest,
  PullRequestTreeRangeMetadata,
} from '../models/pull-request-impact.js';

export interface IPullRequestTreeRangeProvider {
  getPullRequestTreeRange(
    rootPath: string,
    request: PullRequestImpactRequest,
    options?: { readonly maxChangedFiles?: number },
    signal?: AbortSignal,
  ): Promise<Result<PullRequestTreeRangeMetadata>>;
}
