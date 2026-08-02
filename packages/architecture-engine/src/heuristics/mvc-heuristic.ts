/**
 * @module mvc-heuristic
 * @description Detects MVC architecture pattern.
 */

import { RepositoryGraph, RepositoryDNA } from '@project-dna/dna-core';
import { Result } from '@project-dna/shared';
import type { IArchitectureHeuristic, HeuristicResult } from './heuristic.interface';

export class MvcHeuristic implements IArchitectureHeuristic {
  public detect(_graph: RepositoryGraph, _repository: RepositoryDNA): Result<HeuristicResult> {
    // TODO: detect models/, views/, controllers/ folders.
    throw new Error('Not implemented');
  }
}
