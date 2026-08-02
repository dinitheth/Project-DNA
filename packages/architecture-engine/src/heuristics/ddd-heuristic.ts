/**
 * @module ddd-heuristic
 * @description Detects Domain-Driven Design pattern.
 */

import { RepositoryGraph, RepositoryDNA } from '@project-dna/dna-core';
import { Result } from '@project-dna/shared';
import type { IArchitectureHeuristic, HeuristicResult } from './heuristic.interface';

export class DddHeuristic implements IArchitectureHeuristic {
  public detect(_graph: RepositoryGraph, _repository: RepositoryDNA): Result<HeuristicResult> {
    // TODO: detect aggregates/, entities/, value-objects/, repositories/.
    throw new Error('Not implemented');
  }
}
