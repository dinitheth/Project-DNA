/** Detects deterministic dependency cycles in linear graph traversal time. */

import type { CircularDependency, RepositoryGraph } from '@project-dna/dna-core';

export class CircularDependencyAnalyzer {
  public analyze(graph: RepositoryGraph): CircularDependency[] {
    const fileNodes = new Set(graph.getNodesByKind('file'));
    const adjacency = new Map<string, string[]>();
    for (const node of fileNodes) {
      adjacency.set(
        node,
        graph
          .getDependencies(node)
          .filter((dependency) => fileNodes.has(dependency))
          .sort((left, right) => left.localeCompare(right)),
      );
    }

    const cycles = new Map<string, string[]>();
    const state = new Map<string, 'visiting' | 'visited'>();
    const stack: string[] = [];
    const stackPositions = new Map<string, number>();

    for (const start of Array.from(fileNodes).sort((left, right) => left.localeCompare(right))) {
      if (!state.has(start)) this.search(start, adjacency, state, stack, stackPositions, cycles);
    }

    return Array.from(cycles.values())
      .map((chain) => ({ chain: [...chain, chain[0]!], length: chain.length }))
      .sort(
        (left, right) =>
          left.length - right.length || left.chain.join('>').localeCompare(right.chain.join('>')),
      );
  }

  private search(
    current: string,
    adjacency: Map<string, string[]>,
    state: Map<string, 'visiting' | 'visited'>,
    stack: string[],
    stackPositions: Map<string, number>,
    cycles: Map<string, string[]>,
  ): void {
    state.set(current, 'visiting');
    stackPositions.set(current, stack.length);
    stack.push(current);

    for (const neighbor of adjacency.get(current) ?? []) {
      if (!state.has(neighbor)) {
        this.search(neighbor, adjacency, state, stack, stackPositions, cycles);
      } else if (state.get(neighbor) === 'visiting') {
        const position = stackPositions.get(neighbor);
        if (position === undefined) continue;
        const canonical = canonicalizeCycle(stack.slice(position));
        cycles.set(canonical.join('>'), canonical);
      }
    }

    stack.pop();
    stackPositions.delete(current);
    state.set(current, 'visited');
  }
}

function canonicalizeCycle(cycle: readonly string[]): string[] {
  const rotations = cycle.map((_, index) => [...cycle.slice(index), ...cycle.slice(0, index)]);
  rotations.sort((left, right) => left.join('>').localeCompare(right.join('>')));
  return rotations[0] ?? [];
}
