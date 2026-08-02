/**
 * @module microservice-heuristic
 * @description Detects Microservices Architecture pattern.
 */

import { RepositoryGraph, RepositoryDNA } from '@project-dna/dna-core';
import { Result } from '@project-dna/shared';
import type { IArchitectureHeuristic, HeuristicResult } from './heuristic.interface';

export class MicroserviceHeuristic implements IArchitectureHeuristic {
  public detect(_graph: RepositoryGraph, _repository: RepositoryDNA): Result<HeuristicResult> {
    // TODO: detect services/, gateway/ with independent package.json files.
    throw new Error('Not implemented');
  }
}
