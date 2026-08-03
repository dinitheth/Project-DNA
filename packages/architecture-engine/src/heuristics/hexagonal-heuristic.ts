/**
 * @module hexagonal-heuristic
 * @description Detects Hexagonal Architecture pattern.
 */

import type { RepositoryGraph, RepositoryDNA } from '@project-dna/dna-core';
import { Ok, type Result } from '@project-dna/shared';
import type { IArchitectureHeuristic, HeuristicResult } from './heuristic.interface';
import { directionalMatches, inventory, matchingPaths, scoreSignals } from './heuristic-utils.js';

export class HexagonalHeuristic implements IArchitectureHeuristic {
  public detect(graph: RepositoryGraph, _repository: RepositoryDNA): Result<HeuristicResult> {
    const { paths } = inventory(graph);
    const result = scoreSignals([
      {
        rule: 'hexagonal.ports',
        description: 'Ports directory detected',
        matched: matchingPaths(paths, ['ports', 'port']),
        weight: 0.36,
      },
      {
        rule: 'hexagonal.adapters',
        description: 'Adapters directory detected',
        matched: matchingPaths(paths, ['adapters', 'adapter', 'driving', 'driven']),
        weight: 0.36,
      },
      {
        rule: 'hexagonal.domain',
        description: 'Domain core detected',
        matched: matchingPaths(paths, ['domain', 'core']),
        weight: 0.18,
      },
      {
        rule: 'hexagonal.dependencyDirection',
        description: 'Adapters depend toward ports/domain core',
        matched: directionalMatches(
          graph,
          ['adapters', 'infrastructure'],
          ['ports', 'domain', 'core'],
        ),
        weight: 0.08,
      },
    ]);
    return Ok({ pattern: 'hexagonal', ...result });
  }
}
