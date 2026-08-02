/**
 * @module heuristic.interface
 * @description Defines the interface for architecture heuristics.
 */

import { RepositoryGraph, RepositoryDNA } from '@project-dna/dna-core';
import { Result } from '@project-dna/shared';

export interface HeuristicResult {
  pattern: string;
  confidence: number; // 0 to 1
  evidence: string[];
}

export interface IArchitectureHeuristic {
  detect(graph: RepositoryGraph, repository: RepositoryDNA): Result<HeuristicResult>;
}
