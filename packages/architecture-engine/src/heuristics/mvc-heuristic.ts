/**
 * @module mvc-heuristic
 * @description Detects MVC architecture pattern.
 */

import type { RepositoryGraph, RepositoryDNA } from '@project-dna/dna-core';
import { Ok, type Result } from '@project-dna/shared';
import type { IArchitectureHeuristic, HeuristicResult } from './heuristic.interface';
import { inventory, matchingPaths, scoreSignals } from './heuristic-utils';

export class MvcHeuristic implements IArchitectureHeuristic {
  public detect(graph: RepositoryGraph, _repository: RepositoryDNA): Result<HeuristicResult> {
    const { paths } = inventory(graph);
    const result = scoreSignals([
      {
        rule: 'mvc.models',
        description: 'Model directory detected',
        matched: matchingPaths(paths, ['models', 'model']),
        weight: 0.27,
      },
      {
        rule: 'mvc.views',
        description: 'View directory detected',
        matched: matchingPaths(paths, ['views', 'view', 'templates']),
        weight: 0.27,
      },
      {
        rule: 'mvc.controllers',
        description: 'Controller directory detected',
        matched: matchingPaths(paths, ['controllers', 'controller']),
        weight: 0.3,
      },
    ]);
    return Ok({ pattern: 'mvc', ...result });
  }
}
