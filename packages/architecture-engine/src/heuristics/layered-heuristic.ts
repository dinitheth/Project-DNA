/**
 * @module layered-heuristic
 * @description Detects Layered Architecture pattern.
 */

import { RepositoryGraph, RepositoryDNA } from '@project-dna/dna-core';
import { Result } from '@project-dna/shared';
import type { IArchitectureHeuristic, HeuristicResult } from './heuristic.interface';

export class LayeredHeuristic implements IArchitectureHeuristic {
  public detect(_graph: RepositoryGraph, _repository: RepositoryDNA): Result<HeuristicResult> {
    // TODO: detect presentation/, business/, data/ layers.
    throw new Error('Not implemented');
  }
}
