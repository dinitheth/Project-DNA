/**
 * @module ddd-heuristic
 * @description Detects Domain-Driven Design pattern.
 */

import type { RepositoryGraph, RepositoryDNA } from '@project-dna/dna-core';
import { Ok, type Result } from '@project-dna/shared';
import type { IArchitectureHeuristic, HeuristicResult } from './heuristic.interface';
import { inventory, matchingPaths, scoreSignals } from './heuristic-utils';

export class DddHeuristic implements IArchitectureHeuristic {
  public detect(graph: RepositoryGraph, _repository: RepositoryDNA): Result<HeuristicResult> {
    const { paths } = inventory(graph);
    const result = scoreSignals([
      {
        rule: 'ddd.entities',
        description: 'Entity concepts detected',
        matched: matchingPaths(paths, ['entities', 'entity']),
        weight: 0.2,
      },
      {
        rule: 'ddd.valueObjects',
        description: 'Value object concepts detected',
        matched: matchingPaths(paths, ['value-objects', 'valueobjects', 'value-object']),
        weight: 0.22,
      },
      {
        rule: 'ddd.aggregates',
        description: 'Aggregate concepts detected',
        matched: matchingPaths(paths, ['aggregates', 'aggregate']),
        weight: 0.25,
      },
      {
        rule: 'ddd.repositories',
        description: 'Domain repositories detected',
        matched: matchingPaths(paths, ['repositories', 'repository']),
        weight: 0.2,
      },
      {
        rule: 'ddd.contexts',
        description: 'Bounded context structure detected',
        matched: matchingPaths(paths, ['bounded-contexts', 'boundedcontexts', 'contexts']),
        weight: 0.18,
      },
    ]);
    return Ok({ pattern: 'ddd', ...result });
  }
}
