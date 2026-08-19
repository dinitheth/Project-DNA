import type { Result } from '@project-dna/shared';
import type { WorkingTreeChangeSet } from '../models/working-tree-impact.js';

export interface IWorkingTreeChangeSetProvider {
  getWorkingTreeChangeSet(
    rootPath: string,
    options?: { readonly maxChangedPaths?: number },
    signal?: AbortSignal,
  ): Promise<Result<WorkingTreeChangeSet>>;
}
