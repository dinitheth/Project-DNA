/**
 * @module architecture-engine
 * @description Engine for inferring architecture patterns using heuristics.
 */

import { createHash } from 'node:crypto';
import {
  ArchitectureDNASchema,
  type ArchitectureDNA,
  type ArchitectureLayer,
  type ArchitecturePattern,
  type IArchitectureEngine,
  type RepositoryDNA,
  type RepositoryGraph,
} from '@project-dna/dna-core';
import { Err, Ok, type Logger, type Result } from '@project-dna/shared';
import { CleanHeuristic } from './heuristics/clean-heuristic.js';
import { DddHeuristic } from './heuristics/ddd-heuristic.js';
import type { HeuristicResult, IArchitectureHeuristic } from './heuristics/heuristic.interface.js';
import { HexagonalHeuristic } from './heuristics/hexagonal-heuristic.js';
import { LayeredHeuristic } from './heuristics/layered-heuristic.js';
import { MicroserviceHeuristic } from './heuristics/microservice-heuristic.js';
import { MvcHeuristic } from './heuristics/mvc-heuristic.js';
import { normalizePath } from './heuristics/heuristic-utils.js';

const DETECTION_THRESHOLD = 0.35;
const PATTERN_PRIORITY: ArchitecturePattern[] = [
  'hexagonal',
  'clean',
  'ddd',
  'mvc',
  'microservice',
  'layered',
  'modular',
  'monolith',
  'unknown',
];

interface LayerRule {
  role: ArchitectureLayer['role'];
  names: readonly string[];
}

const LAYER_RULES: LayerRule[] = [
  { role: 'test', names: ['test', 'tests', '__tests__', 'spec', 'specs'] },
  { role: 'config', names: ['config', 'configuration'] },
  {
    role: 'presentation',
    names: ['presentation', 'controllers', 'controller', 'views', 'view', 'ui', 'web', 'api'],
  },
  {
    role: 'application',
    names: ['application', 'services', 'service', 'use-cases', 'usecases', 'interactors'],
  },
  {
    role: 'domain',
    names: [
      'domain',
      'entities',
      'entity',
      'aggregates',
      'aggregate',
      'value-objects',
      'valueobjects',
      'ports',
    ],
  },
  {
    role: 'infrastructure',
    names: [
      'infrastructure',
      'adapters',
      'adapter',
      'persistence',
      'data',
      'repositories',
      'repository',
      'dao',
    ],
  },
  { role: 'shared', names: ['shared', 'common', 'utils', 'utilities'] },
];

export class ArchitectureEngine implements IArchitectureEngine {
  private readonly heuristics: IArchitectureHeuristic[];

  constructor(private readonly logger: Logger) {
    this.heuristics = [
      new MvcHeuristic(),
      new CleanHeuristic(),
      new HexagonalHeuristic(),
      new DddHeuristic(),
      new LayeredHeuristic(),
      new MicroserviceHeuristic(),
    ];
  }

  public async inferArchitecture(
    graph: RepositoryGraph,
    repository: RepositoryDNA,
    signal?: AbortSignal,
  ): Promise<Result<ArchitectureDNA>> {
    try {
      if (signal?.aborted) return Err(new Error('Architecture inference cancelled'));

      const results: HeuristicResult[] = [];
      for (const heuristic of this.heuristics) {
        if (signal?.aborted) return Err(new Error('Architecture inference cancelled'));
        const result = heuristic.detect(graph, repository);
        if (!result.ok) return Err(result.error);
        results.push(result.value);
      }

      results.sort(compareResults);
      const best = results[0];
      const pattern = best && best.confidence >= DETECTION_THRESHOLD ? best.pattern : 'unknown';
      const confidence = pattern === 'unknown' ? 0 : (best?.confidence ?? 0);
      const layers = inferLayers(graph);
      const detectedPatterns = results
        .filter((result) => result.confidence > 0)
        .map(({ pattern: detectedPattern, confidence: detectedConfidence }) => ({
          pattern: detectedPattern,
          confidence: detectedConfidence,
        }));
      const evidence = pattern === 'unknown' ? [] : (best?.evidence ?? []);
      const idInput = JSON.stringify({
        repositoryId: repository.id,
        pattern,
        confidence,
        detectedPatterns,
        layers,
      });
      const architecture = ArchitectureDNASchema.parse({
        id: createHash('sha256').update(idInput).digest('hex'),
        pattern,
        confidence,
        detectedPatterns,
        layers,
        evidence,
        detectedAt: Date.now(),
      });

      this.logger.info(
        `Inferred architecture: ${architecture.pattern} (${architecture.confidence.toFixed(2)})`,
      );
      return Ok(architecture);
    } catch (error) {
      const resolvedError = error instanceof Error ? error : new Error(String(error));
      this.logger.error(`Architecture inference failed: ${resolvedError.message}`);
      return Err(resolvedError);
    }
  }
}

function compareResults(left: HeuristicResult, right: HeuristicResult): number {
  const confidenceDifference = right.confidence - left.confidence;
  if (confidenceDifference !== 0) return confidenceDifference;
  return PATTERN_PRIORITY.indexOf(left.pattern) - PATTERN_PRIORITY.indexOf(right.pattern);
}

function inferLayers(graph: RepositoryGraph): ArchitectureLayer[] {
  const layers = new Map<
    ArchitectureLayer['role'],
    { directories: Set<string>; fileCount: number }
  >();

  graph.forEachNode((id, attributes) => {
    if (attributes.kind !== 'file') return;
    const path = normalizePath(attributes.path ?? id);
    const segments = path.split('/');
    const lowerSegments = segments.map((segment) => segment.toLowerCase());
    const rule = LAYER_RULES.find((candidate) =>
      lowerSegments.some((segment) => candidate.names.includes(segment)),
    );
    if (!rule) return;

    const matchedIndex = lowerSegments.findIndex((segment) => rule.names.includes(segment));
    const directory = segments.slice(0, matchedIndex + 1).join('/');
    const layer = layers.get(rule.role) ?? { directories: new Set<string>(), fileCount: 0 };
    layer.directories.add(directory);
    layer.fileCount += 1;
    layers.set(rule.role, layer);
  });

  return LAYER_RULES.flatMap((rule) => {
    const layer = layers.get(rule.role);
    if (!layer) return [];
    return [
      {
        name: roleName(rule.role),
        directories: [...layer.directories].sort(),
        fileCount: layer.fileCount,
        role: rule.role,
      },
    ];
  });
}

function roleName(role: ArchitectureLayer['role']): string {
  return `${role[0]?.toUpperCase() ?? ''}${role.slice(1)}`;
}
