/**
 * @module heuristic.interface
 * @description Defines the interface for architecture heuristics.
 */

import type {
  ArchitectureEvidence,
  ArchitecturePattern,
  RepositoryDNA,
  RepositoryGraph,
} from '@project-dna/dna-core';
import type { Result } from '@project-dna/shared';

export interface HeuristicResult {
  pattern: ArchitecturePattern;
  confidence: number; // 0 to 1
  evidence: ArchitectureEvidence[];
}

export interface IArchitectureHeuristic {
  detect(graph: RepositoryGraph, repository: RepositoryDNA): Result<HeuristicResult>;
}
