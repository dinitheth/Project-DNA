/** Dependency graph construction and structural dependency analysis. */

import type {
  CircularDependency,
  FileDNA,
  IDependencyEngine,
  RepositoryGraph,
} from '@project-dna/dna-core';
import { Err, type Logger, type Result } from '@project-dna/shared';
import { CircularDependencyAnalyzer } from './analyzers/circular-dependency-analyzer.js';
import { GraphBuilder } from './graph/graph-builder.js';

export class DependencyEngine implements IDependencyEngine {
  private readonly graphBuilder: GraphBuilder;
  private readonly circularDependencyAnalyzer = new CircularDependencyAnalyzer();

  constructor(private readonly logger: Logger) {
    this.graphBuilder = new GraphBuilder(logger);
  }

  public async buildDependencyGraph(
    files: FileDNA[],
    rootPath: string,
    signal?: AbortSignal,
  ): Promise<Result<RepositoryGraph>> {
    try {
      if (signal?.aborted) return Err(new Error('Dependency analysis cancelled'));
      const result = this.graphBuilder.build(files, rootPath, signal);
      if (result.ok) {
        this.logger.info(
          `Built dependency graph: ${result.value.nodeCount} nodes, ${result.value.edgeCount} edges`,
        );
      }
      return result;
    } catch (error) {
      const resolvedError = error instanceof Error ? error : new Error(String(error));
      this.logger.error(`Dependency graph construction failed: ${resolvedError.message}`);
      return Err(resolvedError);
    }
  }

  public detectCircularDependencies(graph: RepositoryGraph): CircularDependency[] {
    return this.circularDependencyAnalyzer.analyze(graph);
  }
}
