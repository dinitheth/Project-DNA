/**
 * IDependencyEngine — Contract for dependency graph construction.
 *
 * Implementations build the dependency graph from parsed file data
 * and detect structural issues (circular dependencies, etc.).
 */

import type { Result } from '@project-dna/shared';
import type { FileDNA } from '../models/file-dna.js';
import type { RepositoryGraph } from '../models/repository-graph.js';

/** A detected circular dependency chain. */
export interface CircularDependency {
  /** The cycle as an ordered list of file paths. */
  chain: string[];
  /** Length of the cycle. */
  length: number;
}

export interface IDependencyEngine {
  /**
   * Build the dependency graph from parsed files.
   *
   * @param files - All parsed FileDNA objects.
   * @param rootPath - Repository root for resolving relative paths.
   * @returns The constructed RepositoryGraph.
   */
  buildDependencyGraph(
    files: FileDNA[],
    rootPath: string,
    signal?: AbortSignal,
  ): Promise<Result<RepositoryGraph>>;

  /**
   * Detect circular dependencies in the graph.
   *
   * @param graph - The dependency graph to analyze.
   * @returns All detected cycles.
   */
  detectCircularDependencies(graph: RepositoryGraph): CircularDependency[];
}
