/**
 * IKnowledgeEngine — Contract for structured knowledge generation.
 *
 * Implementations convert analysis results into deterministic KnowledgeNodes.
 * NO AI. NO summaries. Only factual, measurable observations.
 */

import type { Result } from '@project-dna/shared';
import type { RepositoryDNA } from '../models/repository-dna.js';
import type { FileDNA } from '../models/file-dna.js';
import type { RepositoryGraph } from '../models/repository-graph.js';
import type { ArchitectureDNA } from '../models/architecture-dna.js';
import type { KnowledgeNode } from '../models/knowledge-node.js';
import type { RiskNode } from '../models/risk-node.js';

export interface KnowledgeResult {
  /** Generated knowledge nodes. */
  nodes: KnowledgeNode[];
  /** Detected risks/code smells. */
  risks: RiskNode[];
}

/** Input for regenerating knowledge from an incremental repository candidate. */
export interface IncrementalKnowledgeRequest {
  readonly repository: RepositoryDNA;
  readonly files: FileDNA[];
  readonly graph: RepositoryGraph;
  readonly architecture: ArchitectureDNA;
  readonly previous: KnowledgeResult;
  readonly dirtyPaths: readonly string[];
}

export interface IKnowledgeEngine {
  /**
   * Generate structured knowledge from all analysis results.
   *
   * @param repository - Scanned repository DNA.
   * @param files - All parsed file DNA objects.
   * @param graph - The dependency graph.
   * @param architecture - The inferred architecture.
   * @returns Knowledge nodes and risk assessments.
   */
  generateKnowledge(
    repository: RepositoryDNA,
    files: FileDNA[],
    graph: RepositoryGraph,
    architecture: ArchitectureDNA,
    signal?: AbortSignal,
  ): Promise<Result<KnowledgeResult>>;

  /**
   * Regenerate knowledge for an incremental candidate and return a complete result.
   * Implementations may omit this capability; callers must then regenerate fully.
   */
  generateKnowledgeIncremental?(
    request: IncrementalKnowledgeRequest,
    signal?: AbortSignal,
  ): Promise<Result<KnowledgeResult>>;
}
