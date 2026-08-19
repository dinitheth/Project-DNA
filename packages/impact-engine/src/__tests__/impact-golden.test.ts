import { describe, expect, it } from 'vitest';
import type { ImpactResult } from '@project-dna/dna-core';
import {
  architecture,
  calculateFixture,
  capability,
  critical,
  domain,
  emptySemantic,
  entity,
  risk,
  type ImpactFixtureInput,
} from './fixtures/impact-fixture.js';

interface GoldenImpact {
  readonly impacted: readonly string[];
  readonly paths: readonly string[];
  readonly relationships?: readonly string[];
  readonly semantic?: {
    readonly domains?: readonly string[];
    readonly capabilities?: readonly string[];
    readonly criticalComponents?: readonly string[];
    readonly risks?: readonly string[];
    readonly layers?: readonly string[];
    readonly crossings?: readonly string[];
  };
  readonly score: readonly string[];
  readonly total: number;
  readonly warnings?: readonly string[];
  readonly truncations?: readonly string[];
  readonly complete?: boolean;
}

interface GoldenFixture {
  readonly name: string;
  readonly input: ImpactFixtureInput;
  readonly expected: GoldenImpact;
}

const chainNodes = ['A.ts', 'B.ts', 'C.ts'];
const chainEdges = [
  { dependent: 'A.ts', dependency: 'B.ts' },
  { dependent: 'B.ts', dependency: 'C.ts' },
];

const fixtures: readonly GoldenFixture[] = [
  {
    name: 'simple chain',
    input: fixture('chain', chainNodes, chainEdges, 'C.ts'),
    expected: expected(['file:A.ts@2', 'file:B.ts@1'], ['C.ts>B.ts>A.ts', 'C.ts>B.ts'], 23.33),
  },
  {
    name: 'fan-out follows incoming dependency direction',
    input: fixture(
      'fan-out',
      ['A.ts', 'B.ts', 'C.ts', 'D.ts'],
      [
        { dependent: 'A.ts', dependency: 'B.ts' },
        { dependent: 'A.ts', dependency: 'C.ts' },
        { dependent: 'A.ts', dependency: 'D.ts' },
      ],
      'B.ts',
    ),
    expected: expected(['file:A.ts@1'], ['B.ts>A.ts'], 17.5),
  },
  {
    name: 'fan-in returns every direct dependent',
    input: fixture(
      'fan-in',
      ['A.ts', 'B.ts', 'C.ts', 'X.ts'],
      ['A.ts', 'B.ts', 'C.ts'].map((dependent) => ({ dependent, dependency: 'X.ts' })),
      'X.ts',
    ),
    expected: expected(
      ['file:A.ts@1', 'file:B.ts@1', 'file:C.ts@1'],
      ['X.ts>A.ts', 'X.ts>B.ts', 'X.ts>C.ts'],
      26.25,
    ),
  },
  {
    name: 'cycle terminates without returning the target',
    input: fixture(
      'cycle',
      chainNodes,
      [...chainEdges, { dependent: 'C.ts', dependency: 'A.ts' }],
      'A.ts',
    ),
    expected: expected(['file:B.ts@2', 'file:C.ts@1'], ['A.ts>C.ts>B.ts', 'A.ts>C.ts'], 23.33),
  },
  {
    name: 'duplicate edges merge into deterministic relationship metadata',
    input: fixture(
      'parallel',
      ['A.ts', 'B.ts', 'D.ts'],
      [
        { dependent: 'A.ts', dependency: 'B.ts' },
        { dependent: 'B.ts', dependency: 'D.ts' },
        {
          dependent: 'B.ts',
          dependency: 'D.ts',
          attributes: { type: 'type-import', isTypeOnly: true, specifierCount: 2 },
        },
      ],
      'D.ts',
    ),
    expected: {
      ...expected(['file:A.ts@2', 'file:B.ts@1'], ['D.ts>B.ts>A.ts', 'D.ts>B.ts'], 23.33),
      relationships: [
        'file:B.ts->file:D.ts:import:false:3|file:A.ts->file:B.ts:import:false:1',
        'file:B.ts->file:D.ts:import:false:3',
      ],
    },
  },
  {
    name: 'multiple relationship types remain visible in canonical paths',
    input: fixture(
      'relationship-types',
      chainNodes,
      [
        { dependent: 'A.ts', dependency: 'B.ts', attributes: { type: 'require' } },
        {
          dependent: 'B.ts',
          dependency: 'C.ts',
          attributes: { type: 'type-import', isTypeOnly: true },
        },
      ],
      'C.ts',
    ),
    expected: {
      ...expected(['file:A.ts@2', 'file:B.ts@1'], ['C.ts>B.ts>A.ts', 'C.ts>B.ts'], 23.33),
      relationships: [
        'file:B.ts->file:C.ts:type-import:true:1|file:A.ts->file:B.ts:require:false:1',
        'file:B.ts->file:C.ts:type-import:true:1',
      ],
    },
  },
  {
    name: 'multiple domains enrich the bounded structural scope',
    input: {
      ...fixture('domains', chainNodes, chainEdges, 'C.ts'),
      semantic: {
        ...emptySemantic(chainNodes),
        domains: [
          domain('domain:ui', ['file:C.ts']),
          domain('domain:core', ['file:A.ts', 'file:B.ts']),
        ],
      },
    },
    expected: semanticExpected(33.33, {
      domains: ['domain:core', 'domain:ui'],
      score: ['domain-reach:2:0.6666666666666666:0.15:10:available'],
    }),
  },
  {
    name: 'critical-component exposure contributes canonical criticality',
    input: {
      ...fixture('critical', chainNodes, chainEdges, 'C.ts'),
      semantic: {
        ...emptySemantic(chainNodes),
        criticalComponents: [critical('critical:B', 'file:B.ts', 0.75)],
      },
    },
    expected: semanticExpected(42.08, {
      criticalComponents: ['critical:B'],
      score: ['critical-component-exposure:0.75:0.75:0.25:18.75:available'],
    }),
  },
  {
    name: 'risk exposure uses the retained canonical risk severity',
    input: {
      ...fixture('risk', chainNodes, chainEdges, 'C.ts'),
      semantic: {
        ...emptySemantic(chainNodes),
        risks: [risk('risk:high:B', 'high', ['B.ts'])],
      },
    },
    expected: semanticExpected(33.83, {
      risks: ['risk:high:B'],
      score: ['risk-exposure:7:0.7:0.15:10.5:available'],
    }),
  },
  {
    name: 'architecture-layer crossings are directional and deduplicated',
    input: {
      ...fixture('architecture', chainNodes, chainEdges, 'C.ts'),
      semantic: {
        ...emptySemantic(chainNodes),
        entities: [
          entity('A.ts', 'application'),
          entity('B.ts', 'application'),
          entity('C.ts', 'presentation'),
        ],
        architecture: architecture([
          { name: 'presentation', directories: ['src/ui'], fileCount: 1, role: 'presentation' },
          { name: 'application', directories: ['src/app'], fileCount: 2, role: 'application' },
        ]),
      },
    },
    expected: semanticExpected(28.33, {
      layers: ['application', 'presentation'],
      crossings: ['presentation>application:file:B.ts->file:C.ts'],
      score: ['architecture-boundaries:1:0.5:0.1:5:available'],
    }),
  },
  {
    name: 'truncation is explicit and score status becomes partial',
    input: { ...fixture('truncated', chainNodes, chainEdges, 'C.ts'), options: { maxEntities: 1 } },
    expected: {
      ...expected(['file:B.ts@1'], ['C.ts>B.ts'], 17.5),
      score: scoreComponents(1, 'partial', 'partial'),
      truncations: ['max-entities:1:file:A.ts'],
      complete: false,
    },
  },
  {
    name: 'incomplete semantic collections remain explicit',
    input: {
      ...fixture('incomplete', chainNodes, chainEdges, 'C.ts'),
      semantic: { entities: chainNodes.map((node) => entity(node)) },
    },
    expected: {
      ...expected(['file:A.ts@2', 'file:B.ts@1'], ['C.ts>B.ts>A.ts', 'C.ts>B.ts'], 23.33),
      score: [
        dependencyScore(2),
        'critical-component-exposure:0:0:0.25:0:unavailable',
        'domain-reach:0:0:0.15:0:unavailable',
        'risk-exposure:0:0:0.15:0:unavailable',
        'architecture-boundaries:0:0:0.1:0:unavailable',
      ],
      warnings: [
        'Semantic enrichment incomplete: domains unavailable',
        'Semantic enrichment incomplete: capabilities unavailable',
        'Semantic enrichment incomplete: critical components unavailable',
        'Semantic enrichment incomplete: risks unavailable',
        'Semantic enrichment incomplete: architecture layers unavailable',
      ],
    },
  },
  {
    name: 'persisted and restored state preserves the complete semantic result',
    input: {
      ...fixture('restored', chainNodes, chainEdges, 'C.ts'),
      restoreState: true,
      semantic: {
        entities: [
          entity('A.ts', 'application'),
          entity('B.ts', 'application'),
          entity('C.ts', 'presentation'),
        ],
        domains: [
          domain('domain:ui', ['file:C.ts']),
          domain('domain:core', ['file:A.ts', 'file:B.ts']),
        ],
        capabilities: [capability('capability:web', ['file:C.ts'])],
        criticalComponents: [critical('critical:B', 'file:B.ts', 0.75)],
        risks: [risk('risk:high:B', 'high', ['B.ts'])],
        architecture: architecture([
          { name: 'presentation', directories: ['src/ui'], fileCount: 1, role: 'presentation' },
          { name: 'application', directories: ['src/app'], fileCount: 2, role: 'application' },
        ]),
      },
    },
    expected: {
      impacted: ['file:A.ts@2', 'file:B.ts@1'],
      paths: ['C.ts>B.ts>A.ts', 'C.ts>B.ts'],
      semantic: {
        domains: ['domain:core', 'domain:ui'],
        capabilities: ['capability:web'],
        criticalComponents: ['critical:B'],
        risks: ['risk:high:B'],
        layers: ['application', 'presentation'],
        crossings: ['presentation>application:file:B.ts->file:C.ts'],
      },
      score: [
        dependencyScore(2),
        'critical-component-exposure:0.75:0.75:0.25:18.75:available',
        'domain-reach:2:0.6666666666666666:0.15:10:available',
        'risk-exposure:7:0.7:0.15:10.5:available',
        'architecture-boundaries:1:0.5:0.1:5:available',
      ],
      total: 67.58,
      warnings: [],
      truncations: [],
      complete: true,
    },
  },
];

describe('ImpactEngine golden correctness corpus', () => {
  for (const golden of fixtures) {
    it(golden.name, () => {
      expect(project(calculateFixture(golden.input))).toEqual(normalizeExpected(golden.expected));
    });
  }
});

function fixture(
  id: string,
  nodes: readonly string[],
  edges: ImpactFixtureInput['edges'],
  targetPath: string,
): ImpactFixtureInput {
  return {
    id,
    nodes,
    edges,
    target: { kind: 'file', path: targetPath },
    semantic: emptySemantic(nodes),
  };
}

function expected(
  impacted: readonly string[],
  paths: readonly string[],
  total: number,
): GoldenImpact {
  return {
    impacted,
    paths,
    relationships: defaultRelationships(paths),
    score: scoreComponents(impacted.length),
    total,
  };
}

function semanticExpected(
  total: number,
  semantic: NonNullable<GoldenImpact['semantic']> & { readonly score: readonly string[] },
): GoldenImpact {
  const scoreByKind = new Map(semantic.score.map((item) => [item.split(':')[0], item]));
  return {
    impacted: ['file:A.ts@2', 'file:B.ts@1'],
    paths: ['C.ts>B.ts>A.ts', 'C.ts>B.ts'],
    semantic,
    score: scoreComponents(2).map((item) => scoreByKind.get(item.split(':')[0]!) ?? item),
    total,
  };
}

function scoreComponents(
  count: number,
  reachStatus = 'available',
  semanticStatus = 'available',
): string[] {
  return [
    dependencyScore(count, reachStatus),
    `critical-component-exposure:0:0:0.25:0:${semanticStatus}`,
    `domain-reach:0:0:0.15:0:${semanticStatus}`,
    `risk-exposure:0:0:0.15:0:${semanticStatus}`,
    `architecture-boundaries:0:0:0.1:0:${semanticStatus}`,
  ];
}

function defaultRelationships(paths: readonly string[]): string[] {
  return paths.map((path) => {
    const nodes = path.split('>');
    const relationships: string[] = [];
    for (let index = 0; index < nodes.length - 1; index++) {
      const dependency = nodes[index]!;
      const dependent = nodes[index + 1]!;
      relationships.push(`file:${dependent}->file:${dependency}:import:false:1`);
    }
    return relationships.join('|');
  });
}

function dependencyScore(count: number, status = 'available'): string {
  const normalized = count === 0 ? 0 : count / (count + 1);
  const contribution = Math.round((normalized * 35 + Number.EPSILON) * 100) / 100;
  return `dependency-reach:${count}:${normalized}:0.35:${contribution}:${status}`;
}

function project(result: ImpactResult): Required<GoldenImpact> {
  return {
    impacted: [...result.directImpactedEntities, ...result.transitiveImpactedEntities]
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
      .map((node) => `${node.id}@${node.minimumDepth}`),
    paths: result.canonicalPaths.map((path) =>
      path.nodeIds.map((id) => id.slice('file:'.length)).join('>'),
    ),
    relationships: result.canonicalPaths.map((path) =>
      path.relationships
        .map(
          (relationship) =>
            `${relationship.dependentId}->${relationship.dependencyId}:${relationship.type}:${relationship.isTypeOnly}:${relationship.specifierCount}`,
        )
        .join('|'),
    ),
    semantic: {
      domains: result.semanticEffects.domains.map((item) => item.id),
      capabilities: result.semanticEffects.capabilities.map((item) => item.id),
      criticalComponents: result.semanticEffects.criticalComponents.map((item) => item.id),
      risks: result.semanticEffects.risks.map((item) => item.id),
      layers: result.semanticEffects.architecture.layers.map((item) => item.name),
      crossings: result.semanticEffects.architecture.boundaryCrossings.map(
        (item) => `${item.fromLayer}>${item.toLayer}:${item.dependentId}->${item.dependencyId}`,
      ),
    },
    score: result.score.components.map(
      (item) =>
        `${item.kind}:${item.rawInput}:${item.normalizedValue}:${item.weight}:${item.contribution}:${item.status}`,
    ),
    total: result.score.total,
    warnings: result.warnings,
    truncations: result.truncations.map(
      (item) => `${item.kind}:${item.limit}:${item.atEntityId ?? 'null'}`,
    ),
    complete: result.complete,
  };
}

function normalizeExpected(expectedValue: GoldenImpact): Required<GoldenImpact> {
  return {
    impacted: expectedValue.impacted,
    paths: expectedValue.paths,
    relationships: expectedValue.relationships ?? defaultRelationships(expectedValue.paths),
    semantic: {
      domains: expectedValue.semantic?.domains ?? [],
      capabilities: expectedValue.semantic?.capabilities ?? [],
      criticalComponents: expectedValue.semantic?.criticalComponents ?? [],
      risks: expectedValue.semantic?.risks ?? [],
      layers: expectedValue.semantic?.layers ?? [],
      crossings: expectedValue.semantic?.crossings ?? [],
    },
    score: expectedValue.score,
    total: expectedValue.total,
    warnings: expectedValue.warnings ?? [],
    truncations: expectedValue.truncations ?? [],
    complete: expectedValue.complete ?? true,
  };
}
