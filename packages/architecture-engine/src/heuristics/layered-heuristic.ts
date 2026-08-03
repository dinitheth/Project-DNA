/**
 * @module layered-heuristic
 * @description Detects Layered Architecture pattern.
 */

import type { RepositoryGraph, RepositoryDNA } from '@project-dna/dna-core';
import { Ok, type Result } from '@project-dna/shared';
import type { IArchitectureHeuristic, HeuristicResult } from './heuristic.interface';
import { directionalMatches, inventory, matchingPaths, scoreSignals } from './heuristic-utils.js';

export class LayeredHeuristic implements IArchitectureHeuristic {
  public detect(graph: RepositoryGraph, _repository: RepositoryDNA): Result<HeuristicResult> {
    const { paths } = inventory(graph);
    const result = scoreSignals([
      {
        rule: 'layered.presentation',
        description: 'Presentation layer detected',
        matched: matchingPaths(paths, ['presentation', 'controllers', 'ui', 'web']),
        weight: 0.27,
      },
      {
        rule: 'layered.business',
        description: 'Business/service layer detected',
        matched: matchingPaths(paths, ['business', 'services', 'service', 'application']),
        weight: 0.27,
      },
      {
        rule: 'layered.data',
        description: 'Data/persistence layer detected',
        matched: matchingPaths(paths, ['data', 'persistence', 'repositories', 'dao']),
        weight: 0.27,
      },
      {
        rule: 'layered.dependencyDirection',
        description: 'Upper layers depend toward lower layers',
        matched: directionalMatches(
          graph,
          ['presentation', 'controllers', 'application', 'services'],
          ['business', 'data', 'persistence', 'repositories'],
        ),
        weight: 0.08,
      },
    ]);
    return Ok({ pattern: 'layered', ...result });
  }
}
