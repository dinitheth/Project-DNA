import { Err, Ok, type Result } from '@project-dna/shared';
import type { ImpactRelationship, ImpactTruncation } from '../models/impact.js';
import type { GraphEdgeAttributes, RepositoryGraph } from '../models/repository-graph.js';

export type DependencyTraversalDirection = 'dependents' | 'dependencies' | 'connected';

export interface DependencyTraversalOptions {
  readonly direction: DependencyTraversalDirection;
  readonly maxDepth: number;
  readonly maxEntities: number;
  readonly missingStartNode?: 'error' | 'ignore';
}

export interface DependencyTraversalNode {
  readonly id: string;
  readonly minimumDepth: number;
  /** Previous node on the canonical shortest path from a start node. */
  readonly predecessorId: string;
  /** Stored importer -> imported relationship joining this node to its predecessor. */
  readonly relationship: ImpactRelationship;
}

export interface DependencyTraversalResult {
  readonly startIds: string[];
  readonly nodes: DependencyTraversalNode[];
  readonly complete: boolean;
  readonly truncations: ImpactTruncation[];
}

export interface DependencyTraversalRequest {
  readonly graphs: readonly RepositoryGraph[];
  readonly startIds: readonly string[];
  readonly options: DependencyTraversalOptions;
}

interface QueueEntry {
  readonly id: string;
  readonly depth: number;
}

interface NeighborCandidate {
  readonly id: string;
  readonly relationship: ImpactRelationship;
}

/**
 * Compare identifiers by UTF-16 code unit order. This is stable across hosts and locales.
 */
export function compareOrdinalStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Traverse one or more repository dependency graphs without exposing Graphology.
 * Stored edges remain importer -> imported; dependent impact therefore uses `dependents`.
 */
export function traverseDependencyGraph(
  request: DependencyTraversalRequest,
  signal?: AbortSignal,
): Result<DependencyTraversalResult> {
  const optionsError = validateOptions(request.options);
  if (optionsError) return Err(optionsError);
  if (signal?.aborted) return cancelled();

  const requestedStartIds = [...new Set(request.startIds)].sort(compareOrdinalStrings);
  const startIds: string[] = [];
  for (const startId of requestedStartIds) {
    if (signal?.aborted) return cancelled();
    const kinds = request.graphs
      .map((graph) => graph.getNodeAttributes(startId)?.kind)
      .filter((kind) => kind !== undefined);
    if (kinds.includes('file')) {
      startIds.push(startId);
      continue;
    }
    if (kinds.length === 0) {
      if (request.options.missingStartNode === 'ignore') continue;
      return Err(new Error(`Dependency traversal target not found: ${startId}`));
    }
    return Err(new Error(`Dependency traversal only supports file nodes: ${startId}`));
  }

  const visited = new Set(startIds);
  const queue: QueueEntry[] = startIds.map((id) => ({ id, depth: 0 }));
  const nodes: DependencyTraversalNode[] = [];
  let depthTruncation: ImpactTruncation | undefined;
  let entityTruncation: ImpactTruncation | undefined;

  traversal: for (let index = 0; index < queue.length; index++) {
    if (signal?.aborted) return cancelled();
    const current = queue[index];
    if (!current) continue;
    const neighbors = collectNeighbors(
      request.graphs,
      current.id,
      request.options.direction,
      signal,
    );
    if (!neighbors.ok) return neighbors;

    for (const neighbor of neighbors.value) {
      if (signal?.aborted) return cancelled();
      if (visited.has(neighbor.id)) continue;
      const nextDepth = current.depth + 1;
      if (nextDepth > request.options.maxDepth) {
        depthTruncation ??= {
          kind: 'max-depth',
          limit: request.options.maxDepth,
          atEntityId: neighbor.id,
        };
        continue;
      }
      if (nodes.length >= request.options.maxEntities) {
        entityTruncation = {
          kind: 'max-entities',
          limit: request.options.maxEntities,
          atEntityId: neighbor.id,
        };
        break traversal;
      }

      visited.add(neighbor.id);
      nodes.push({
        id: neighbor.id,
        minimumDepth: nextDepth,
        predecessorId: current.id,
        relationship: neighbor.relationship,
      });
      queue.push({ id: neighbor.id, depth: nextDepth });
    }
  }

  const truncations = [depthTruncation, entityTruncation].filter(
    (truncation): truncation is ImpactTruncation => truncation !== undefined,
  );
  return Ok({
    startIds,
    nodes: nodes.sort((left, right) => compareOrdinalStrings(left.id, right.id)),
    complete: truncations.length === 0,
    truncations,
  });
}

function collectNeighbors(
  graphs: readonly RepositoryGraph[],
  nodeId: string,
  direction: DependencyTraversalDirection,
  signal?: AbortSignal,
): Result<NeighborCandidate[]> {
  const candidates = new Map<string, ImpactRelationship[]>();
  for (const graph of graphs) {
    if (signal?.aborted) return cancelled();
    if (direction !== 'dependencies') {
      for (const dependentId of graph.getDependents(nodeId)) {
        if (signal?.aborted) return cancelled();
        addCandidate(candidates, graph, dependentId, nodeId, dependentId);
      }
    }
    if (direction !== 'dependents') {
      for (const dependencyId of graph.getDependencies(nodeId)) {
        if (signal?.aborted) return cancelled();
        addCandidate(candidates, graph, nodeId, dependencyId, dependencyId);
      }
    }
  }

  return Ok(
    [...candidates.entries()]
      .sort(([left], [right]) => compareOrdinalStrings(left, right))
      .map(([id, relationships]) => ({
        id,
        relationship: relationships.sort(compareRelationships)[0]!,
      })),
  );
}

function addCandidate(
  candidates: Map<string, ImpactRelationship[]>,
  graph: RepositoryGraph,
  dependentId: string,
  dependencyId: string,
  neighborId: string,
): void {
  const neighbor = graph.getNodeAttributes(neighborId);
  const edge = graph.getEdgeAttributes(dependentId, dependencyId);
  if (neighbor?.kind !== 'file' || !edge || edge.isExternal) return;
  const relationships = candidates.get(neighborId) ?? [];
  relationships.push(toRelationship(dependentId, dependencyId, edge));
  candidates.set(neighborId, relationships);
}

function toRelationship(
  dependentId: string,
  dependencyId: string,
  edge: GraphEdgeAttributes,
): ImpactRelationship {
  return {
    dependentId,
    dependencyId,
    type: edge.type,
    isTypeOnly: edge.isTypeOnly,
    specifierCount: edge.specifierCount,
  };
}

function compareRelationships(left: ImpactRelationship, right: ImpactRelationship): number {
  return (
    compareOrdinalStrings(left.dependentId, right.dependentId) ||
    compareOrdinalStrings(left.dependencyId, right.dependencyId) ||
    compareOrdinalStrings(left.type, right.type) ||
    Number(left.isTypeOnly) - Number(right.isTypeOnly) ||
    left.specifierCount - right.specifierCount
  );
}

function validateOptions(options: DependencyTraversalOptions): Error | null {
  if (!['dependents', 'dependencies', 'connected'].includes(options.direction)) {
    return new Error(`Unsupported dependency traversal direction: ${options.direction}`);
  }
  if (!Number.isSafeInteger(options.maxDepth) || options.maxDepth < 0) {
    return new Error('Dependency traversal maxDepth must be a safe nonnegative integer');
  }
  if (!Number.isSafeInteger(options.maxEntities) || options.maxEntities <= 0) {
    return new Error('Dependency traversal maxEntities must be a safe positive integer');
  }
  return null;
}

function cancelled(): Result<never> {
  return Err(new Error('Dependency traversal cancelled'));
}
