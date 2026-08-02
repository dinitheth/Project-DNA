/**
 * IArchitectureEngine — Contract for architecture pattern inference.
 *
 * Implementations use heuristics only (folder structure, naming conventions,
 * dependency direction) to infer architectural patterns. NO AI.
 */

import type { Result } from '@project-dna/shared';
import type { RepositoryDNA } from '../models/repository-dna.js';
import type { RepositoryGraph } from '../models/repository-graph.js';
import type { ArchitectureDNA } from '../models/architecture-dna.js';

export interface IArchitectureEngine {
  /**
   * Infer the architectural pattern of a repository.
   *
   * @param graph - The dependency graph.
   * @param repository - The scanned repository DNA.
   * @returns The inferred architecture with confidence scores and evidence.
   */
  inferArchitecture(
    graph: RepositoryGraph,
    repository: RepositoryDNA,
    signal?: AbortSignal,
  ): Promise<Result<ArchitectureDNA>>;
}
