import type { Result } from '@project-dna/shared';
import type {
  PullRequestImpactOptions,
  PullRequestImpactRequest,
  PullRequestImpactResult,
} from '../models/pull-request-impact.js';

export interface IProjectDNAPullRequestImpact {
  getPullRequestImpact(
    request: PullRequestImpactRequest,
    options?: PullRequestImpactOptions,
    signal?: AbortSignal,
  ): Promise<Result<PullRequestImpactResult>>;
}
