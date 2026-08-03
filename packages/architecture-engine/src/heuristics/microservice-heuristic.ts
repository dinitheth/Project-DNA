/**
 * @module microservice-heuristic
 * @description Detects Microservices Architecture pattern.
 */

import type { RepositoryGraph, RepositoryDNA } from '@project-dna/dna-core';
import { Ok, type Result } from '@project-dna/shared';
import type { IArchitectureHeuristic, HeuristicResult } from './heuristic.interface';
import { inventory, matchingPaths, scoreSignals } from './heuristic-utils';

export class MicroserviceHeuristic implements IArchitectureHeuristic {
  public detect(graph: RepositoryGraph, _repository: RepositoryDNA): Result<HeuristicResult> {
    const { paths } = inventory(graph);
    const servicePaths = paths.filter((path) => /(?:^|\/)(services|apps)\/[^/]+\//i.test(path));
    const distinctServices = new Set(
      servicePaths.map((path) => {
        const segments = path.toLowerCase().split('/');
        const containerIndex = segments.findIndex(
          (segment) => segment === 'services' || segment === 'apps',
        );
        return segments.slice(0, containerIndex + 2).join('/');
      }),
    );
    const topology = distinctServices.size >= 2 ? servicePaths : [];
    const result = scoreSignals([
      {
        rule: 'microservice.services',
        description: 'Multiple independently named service/app areas detected',
        matched: topology,
        weight: distinctServices.size >= 3 ? 0.62 : 0.45,
      },
      {
        rule: 'microservice.gateway',
        description: 'Gateway/API gateway detected',
        matched: matchingPaths(paths, ['gateway', 'api-gateway', 'apigateway']),
        weight: 0.2,
      },
      {
        rule: 'microservice.messaging',
        description: 'Inter-service messaging boundary detected',
        matched: matchingPaths(paths, ['events', 'messaging', 'queues', 'pubsub']),
        weight: 0.12,
      },
    ]);
    return Ok({ pattern: 'microservice', ...result });
  }
}
