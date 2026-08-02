/**
 * @module hexagonal-heuristic
 * @description Detects Hexagonal Architecture pattern.
 */

import { RepositoryGraph, RepositoryDNA } from '@project-dna/dna-core';
import { Result } from '@project-dna/shared';
import type { IArchitectureHeuristic, HeuristicResult } from './heuristic.interface';

export class HexagonalHeuristic implements IArchitectureHeuristic {
  public detect(_graph: RepositoryGraph, _repository: RepositoryDNA): Result<HeuristicResult> {
    // TODO: detect ports/, adapters/ pattern.
    throw new Error('Not implemented');
  }
}
