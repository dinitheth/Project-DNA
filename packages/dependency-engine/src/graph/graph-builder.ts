/**
 * @module graph-builder
 * @description Builds a repository graph from file information.
 */

import { FileDNA, RepositoryGraph } from '@project-dna/dna-core';
import { Result } from '@project-dna/shared';

export class GraphBuilder {
  public build(_files: FileDNA[], _rootPath: string): Result<RepositoryGraph> {
    // TODO: Implement graph building
    // 1. Create nodes for files
    // 2. Create edges for imports
    throw new Error('Not implemented');
  }
}
