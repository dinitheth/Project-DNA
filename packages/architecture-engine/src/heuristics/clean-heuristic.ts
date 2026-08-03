/**
 * @module clean-heuristic
 * @description Detects Clean Architecture pattern.
 */

import type { RepositoryGraph, RepositoryDNA } from '@project-dna/dna-core';
import { Ok, type Result } from '@project-dna/shared';
import type { IArchitectureHeuristic, HeuristicResult } from './heuristic.interface';
import { directionalMatches, inventory, matchingPaths, scoreSignals } from './heuristic-utils.js';

export class CleanHeuristic implements IArchitectureHeuristic {
  public detect(graph: RepositoryGraph, _repository: RepositoryDNA): Result<HeuristicResult> {
    const { paths } = inventory(graph);
    const result = scoreSignals([
      {
        rule: 'clean.domain',
        description: 'Domain layer detected',
        matched: matchingPaths(paths, ['domain', 'entities', 'use-cases']),
        weight: 0.28,
      },
      {
        rule: 'clean.application',
        description: 'Application layer detected',
        matched: matchingPaths(paths, ['application', 'use-cases', 'interactors']),
        weight: 0.24,
      },
      {
        rule: 'clean.infrastructure',
        description: 'Infrastructure layer detected',
        matched: matchingPaths(paths, ['infrastructure', 'adapters', 'persistence']),
        weight: 0.24,
      },
      {
        rule: 'clean.presentation',
        description: 'Presentation layer detected',
        matched: matchingPaths(paths, ['presentation', 'controllers', 'api']),
        weight: 0.14,
      },
      {
        rule: 'clean.dependencyDirection',
        description: 'Outer layers depend toward application/domain layers',
        matched: directionalMatches(
          graph,
          ['presentation', 'infrastructure', 'adapters'],
          ['application', 'domain', 'use-cases'],
        ),
        weight: 0.08,
      },
    ]);
    return Ok({ pattern: 'clean', ...result });
  }
}
