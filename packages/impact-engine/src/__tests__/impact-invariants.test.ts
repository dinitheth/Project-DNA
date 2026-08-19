import { describe, expect, it } from 'vitest';
import {
  calculateFixture,
  calculateState,
  createFixtureState,
  emptySemantic,
  type ImpactFixtureEdge,
  type ImpactFixtureInput,
} from './fixtures/impact-fixture.js';

const FULL_BOUNDS = { maxDepth: 32, maxEntities: 500, maxEvidencePaths: 3 } as const;

describe('ImpactEngine deterministic invariants', () => {
  it('matches an independent minimum-depth oracle across generated cyclic graphs', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const fixture = generatedFixture(seed, 48);
      const result = calculateFixture(fixture);
      const expectedDepths = shortestDependentDepths(
        fixture.nodes,
        fixture.edges,
        targetPath(fixture),
      );
      const impacted = [
        ...result.directImpactedEntities,
        ...result.transitiveImpactedEntities,
      ].sort((left, right) => compare(left.id, right.id));

      expect(new Set(impacted.map((node) => node.id)).size, `unique seed ${seed}`).toBe(
        impacted.length,
      );
      expect(impacted.some((node) => node.id === `file:${targetPath(fixture)}`)).toBe(false);
      expect(
        impacted.map((node) => [node.id.slice('file:'.length), node.minimumDepth]),
        `minimum depth seed ${seed}`,
      ).toEqual(
        [...expectedDepths.entries()]
          .sort(([left], [right]) => compare(left, right))
          .map(([id, depth]) => [id, depth]),
      );
      expect(
        result.truncations.filter((item) => item.kind !== 'max-evidence-paths'),
        `structural completeness seed ${seed}`,
      ).toEqual([]);
    }
  });

  it('always honors entity, depth, and path bounds on cyclic input', () => {
    const base = generatedFixture(117, 96);
    for (const maxDepth of [0, 1, 2, 4, 8, 16, 32]) {
      for (const maxEntities of [1, 2, 7, 31, 127]) {
        for (const maxEvidencePaths of [1, 2, 3]) {
          const result = calculateFixture({
            ...base,
            options: { maxDepth, maxEntities, maxEvidencePaths },
          });
          const impacted = [...result.directImpactedEntities, ...result.transitiveImpactedEntities];
          expect(impacted.length).toBeLessThanOrEqual(maxEntities);
          expect(impacted.every((node) => node.minimumDepth <= maxDepth)).toBe(true);
          expect(result.canonicalPaths.length).toBeLessThanOrEqual(maxEvidencePaths);
          expect(new Set(impacted.map((node) => node.id)).size).toBe(impacted.length);
          expect(impacted.some((node) => node.id === `file:${targetPath(base)}`)).toBe(false);
        }
      }
    }
  }, 30_000);

  it('is byte-stable across insertion order, equivalent state, restoration, and repeated calls', () => {
    for (let seed = 200; seed < 210; seed++) {
      const fixture = generatedFixture(seed, 64);
      const reversed: ImpactFixtureInput = {
        ...fixture,
        nodes: [...fixture.nodes].reverse(),
        edges: [...fixture.edges].reverse(),
        semantic: reverseSemantic(fixture.semantic),
      };
      const firstState = createFixtureState(fixture);
      const equivalentState = createFixtureState(reversed);
      const restoredState = JSON.parse(JSON.stringify(firstState)) as typeof firstState;
      const target = fixture.target;
      const first = calculateState(firstState, target, FULL_BOUNDS);
      const repeated = calculateState(firstState, target, FULL_BOUNDS);
      const reordered = calculateState(equivalentState, target, FULL_BOUNDS);
      const restored = calculateState(restoredState, target, FULL_BOUNDS);
      const serialized = JSON.stringify(first);

      expect(JSON.stringify(repeated), `repeat seed ${seed}`).toBe(serialized);
      expect(JSON.stringify(reordered), `order seed ${seed}`).toBe(serialized);
      expect(JSON.stringify(restored), `restore seed ${seed}`).toBe(serialized);
    }
  });

  it('keeps every score bounded and every contribution mathematically consistent', () => {
    for (let seed = 300; seed < 340; seed++) {
      const result = calculateFixture(generatedFixture(seed, 72));
      expect(result.score.total).toBeGreaterThanOrEqual(0);
      expect(result.score.total).toBeLessThanOrEqual(100);
      for (const component of result.score.components) {
        expect(component.normalizedValue).toBeGreaterThanOrEqual(0);
        expect(component.normalizedValue).toBeLessThanOrEqual(1);
        expect(component.contribution).toBe(
          round(component.normalizedValue * component.weight * 100),
        );
      }
      expect(result.score.total).toBe(
        round(result.score.components.reduce((total, item) => total + item.contribution, 0)),
      );
    }
  });

  it('terminates dense cycles within a bounded test deadline', () => {
    const nodes = Array.from({ length: 200 }, (_, index) => nodeId(index));
    const edges: ImpactFixtureEdge[] = [];
    for (let index = 0; index < nodes.length; index++) {
      for (let offset = 1; offset <= 8; offset++) {
        edges.push({
          dependent: nodes[index]!,
          dependency: nodes[(index + offset) % nodes.length]!,
        });
      }
    }
    const result = calculateFixture({
      id: 'dense-cycle',
      nodes,
      edges,
      target: { kind: 'file', path: nodes[0]! },
      semantic: emptySemantic(nodes),
      options: FULL_BOUNDS,
    });
    expect(result.directImpactedEntities.length + result.transitiveImpactedEntities.length).toBe(
      nodes.length - 1,
    );
    expect(result.truncations.filter((item) => item.kind !== 'max-evidence-paths')).toEqual([]);
    expect(result.truncations).toEqual([
      { kind: 'max-evidence-paths', limit: 3, atEntityId: 'file:node-0004.ts' },
    ]);
  }, 2_000);
});

function generatedFixture(seed: number, size: number): ImpactFixtureInput {
  const nodes = Array.from({ length: size }, (_, index) => nodeId(index));
  const edges: ImpactFixtureEdge[] = [];
  const random = randomSequence(seed);
  for (let index = 0; index < size; index++) {
    edges.push({ dependent: nodes[index]!, dependency: nodes[(index + 1) % size]! });
    for (let extra = 0; extra < 3; extra++) {
      const dependencyIndex = Math.floor(random() * size);
      if (dependencyIndex === index) continue;
      edges.push({
        dependent: nodes[index]!,
        dependency: nodes[dependencyIndex]!,
        attributes: {
          type: ['import', 're-export', 'dynamic-import', 'require', 'type-import'][
            Math.floor(random() * 5)
          ] as NonNullable<ImpactFixtureEdge['attributes']>['type'],
          isTypeOnly: random() > 0.7,
          specifierCount: 1 + Math.floor(random() * 4),
        },
      });
    }
  }
  return {
    id: `generated-${seed}`,
    nodes,
    edges,
    target: { kind: 'file', path: nodes[0]! },
    semantic: emptySemantic(nodes),
    options: FULL_BOUNDS,
  };
}

function shortestDependentDepths(
  nodes: readonly string[],
  edges: readonly ImpactFixtureEdge[],
  target: string,
): ReadonlyMap<string, number> {
  const dependents = new Map(nodes.map((node) => [node, new Set<string>()]));
  for (const edge of edges) dependents.get(edge.dependency)?.add(edge.dependent);
  const depths = new Map<string, number>();
  const visited = new Set([target]);
  const queue = [{ id: target, depth: 0 }];
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index]!;
    for (const dependent of [...(dependents.get(current.id) ?? [])].sort(compare)) {
      if (visited.has(dependent)) continue;
      visited.add(dependent);
      const depth = current.depth + 1;
      depths.set(dependent, depth);
      queue.push({ id: dependent, depth });
    }
  }
  return depths;
}

function reverseSemantic(semantic: ImpactFixtureInput['semantic']): ImpactFixtureInput['semantic'] {
  if (!semantic) return semantic;
  return {
    entities: semantic.entities ? [...semantic.entities].reverse() : semantic.entities,
    domains: semantic.domains ? [...semantic.domains].reverse() : semantic.domains,
    capabilities: semantic.capabilities
      ? [...semantic.capabilities].reverse()
      : semantic.capabilities,
    criticalComponents: semantic.criticalComponents
      ? [...semantic.criticalComponents].reverse()
      : semantic.criticalComponents,
    risks: semantic.risks ? [...semantic.risks].reverse() : semantic.risks,
    architecture: semantic.architecture
      ? { ...semantic.architecture, layers: [...semantic.architecture.layers].reverse() }
      : semantic.architecture,
  };
}

function targetPath(fixture: ImpactFixtureInput): string {
  if (fixture.target.kind !== 'file') throw new Error('Generated fixture target must be a file');
  return fixture.target.path;
}

function nodeId(index: number): string {
  return `node-${index.toString().padStart(4, '0')}.ts`;
}

function randomSequence(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
