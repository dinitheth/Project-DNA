import { describe, expect, it } from 'vitest';
import {
  ArchitectureDNASchema,
  FileDNASchema,
  RepositoryDNASchema,
  RepositoryGraph,
} from '@project-dna/dna-core';
import { createSilentLogger, isErr } from '@project-dna/shared';
import { KnowledgeEngine } from '../knowledge-engine.js';
import { PatternGenerator } from '../generators/pattern-generator.js';

describe('KnowledgeEngine', () => {
  it('generates structural knowledge and measurable risks', async () => {
    const files = [
      file('src/index.ts', { linesOfCode: 40, complexity: 1, imports: 0, exports: 20 }),
      file('src/complex.ts', { linesOfCode: 600, complexity: 35, imports: 22 }),
      file('src/a.ts', { imports: 1 }),
      file('src/b.ts', { imports: 1 }),
    ];
    const graph = new RepositoryGraph();
    for (const item of files) graph.addFileNode(item.path, { label: item.path, path: item.path });
    edge(graph, 'src/a.ts', 'src/b.ts');
    edge(graph, 'src/b.ts', 'src/a.ts');

    const result = await new KnowledgeEngine(createSilentLogger()).generateKnowledge(
      repository(),
      files,
      graph,
      architecture(),
    );
    if (isErr(result)) throw result.error;

    expect(result.value.nodes.map((node) => node.name)).toEqual(
      expect.arrayContaining(['Barrel export pattern', 'Architecture: clean']),
    );
    expect(result.value.risks.map((risk) => risk.type)).toEqual(
      expect.arrayContaining([
        'high-complexity',
        'large-file',
        'excessive-imports',
        'circular-dependency',
        'barrel-explosion',
      ]),
    );
  });

  it('detects dynamic loading and stable naming conventions', async () => {
    const files = [
      file('src/user-service.ts', { dynamicImports: 1 }),
      file('src/order-service.ts'),
      file('src/payment-service.ts'),
    ];
    const graph = new RepositoryGraph();
    for (const item of files) graph.addFileNode(item.path, { label: item.path, path: item.path });
    const nodes = new PatternGenerator().generate(files, graph, 1);
    expect(nodes.map((node) => node.name)).toContain('Dynamic loading pattern');
    const result = await new KnowledgeEngine(createSilentLogger()).generateKnowledge(
      repository(),
      files,
      graph,
      architecture(),
    );
    if (isErr(result)) throw result.error;
    expect(result.value.nodes.map((node) => node.name)).toContain(
      'Dominant kebab-case file naming',
    );
  });

  it('detects unstable modules from internal coupling direction', async () => {
    const files = [
      file('src/hub.ts'),
      ...Array.from({ length: 8 }, (_, index) => file(`src/dependency-${index}.ts`)),
    ];
    const graph = new RepositoryGraph();
    for (const item of files) graph.addFileNode(item.path, { label: item.path, path: item.path });
    for (const dependency of files.slice(1)) edge(graph, 'src/hub.ts', dependency.path);
    const result = await new KnowledgeEngine(createSilentLogger()).generateKnowledge(
      repository(),
      files,
      graph,
      architecture(),
    );
    if (isErr(result)) throw result.error;
    expect(result.value.risks.map((risk) => risk.type)).toContain('unstable-module');
  });

  it('honors cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await new KnowledgeEngine(createSilentLogger()).generateKnowledge(
      repository(),
      [],
      new RepositoryGraph(),
      architecture(),
      controller.signal,
    );
    expect(isErr(result)).toBe(true);
  });
});

function file(
  path: string,
  overrides: {
    linesOfCode?: number;
    complexity?: number;
    imports?: number;
    exports?: number;
    dynamicImports?: number;
  } = {},
) {
  const imports = Array.from(
    { length: Math.max(overrides.imports ?? 0, overrides.dynamicImports ?? 0) },
    (_, index) => ({
      source: `./dependency-${index}`,
      specifiers: [],
      isTypeOnly: false,
      isDynamic: index < (overrides.dynamicImports ?? 0),
    }),
  );
  const exports = Array.from({ length: overrides.exports ?? 0 }, (_, index) => ({
    name: `item-${index}`,
    type: 'barrel' as const,
    isTypeOnly: false,
    source: `./module-${index}`,
  }));
  return FileDNASchema.parse({
    id: path,
    path,
    language: 'typescript',
    hash: path,
    size: 100,
    linesOfCode: overrides.linesOfCode ?? 10,
    classIds: [],
    functionIds: [],
    imports,
    exports,
    comments: [],
    complexity: overrides.complexity ?? 1,
  });
}

function edge(graph: RepositoryGraph, source: string, target: string): void {
  graph.addDependency(source, target, {
    type: 'import',
    isTypeOnly: false,
    specifierCount: 1,
    isExternal: false,
  });
}

function repository() {
  return RepositoryDNASchema.parse({
    id: 'repository-id',
    name: 'fixture',
    rootPath: 'C:/fixture',
    languages: [],
    frameworks: [],
    metadata: {
      hasReadme: false,
      hasLicense: false,
      hasGitIgnore: false,
      hasTsConfig: true,
      hasPackageJson: true,
    },
    totalFiles: 4,
    totalLinesOfCode: 700,
    createdAt: 1,
    updatedAt: 1,
  });
}

function architecture() {
  return ArchitectureDNASchema.parse({
    id: 'architecture-id',
    pattern: 'clean',
    confidence: 0.9,
    detectedPatterns: [{ pattern: 'clean', confidence: 0.9 }],
    layers: [],
    evidence: [],
    detectedAt: 1,
  });
}
