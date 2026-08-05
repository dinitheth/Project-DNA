import { describe, expect, it } from 'vitest';
import {
  ArchitectureDNASchema,
  FileDNASchema,
  RepositoryDNASchema,
  RepositoryGraph,
  type FileDNA,
} from '@project-dna/dna-core';
import { createSilentLogger, isErr } from '@project-dna/shared';
import { DNAEngine } from '../dna-engine.js';

describe('DNAEngine data integrity', () => {
  it('uses real LOC and canonical entity IDs for domains, capabilities, and relationships', async () => {
    const files = [
      file('src/components/app.ts', 10, 'typescript', ['react']),
      file('src/components/view.ts', 5, 'typescript', ['react']),
      file('lib/logger.ts', 7),
      file('lib/cache.js', 78, 'javascript'),
    ];
    const graph = graphFor(files);
    graph.addDependency('src/components/app.ts', 'lib/logger.ts', {
      type: 'import',
      isTypeOnly: false,
      specifierCount: 1,
      isExternal: false,
    });

    const result = await new DNAEngine(createSilentLogger()).synthesize({
      repository: repository(files.length),
      files,
      dependencyGraph: graph,
      architecture: architecture(),
      knowledgeNodes: [],
      risks: [],
    });
    if (isErr(result)) throw result.error;

    expect(result.value.profile.primaryLanguages).toEqual([
      {
        language: 'JavaScript',
        percentage: 78,
        fileCount: 1,
        linesOfCode: 78,
      },
      {
        language: 'TypeScript',
        percentage: 22,
        fileCount: 3,
        linesOfCode: 22,
      },
    ]);
    expect(result.value.domains).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'domain:src', linesOfCode: 15, dependsOn: ['domain:lib'] }),
        expect.objectContaining({ id: 'domain:lib', linesOfCode: 85 }),
      ]),
    );

    const appEntity = result.value.entities.find(
      (entity) => entity.path === 'src/components/app.ts',
    );
    expect(appEntity?.dependsOn).toEqual(['file:lib/logger.ts']);
    expect(result.value.entities.map((entity) => entity.id)).toContain('file:lib/logger.ts');

    const uiCapability = result.value.capabilities.find(
      (capability) => capability.name === 'UI Rendering',
    );
    expect(uiCapability?.implementedBy).toEqual([
      'file:src/components/app.ts',
      'file:src/components/view.ts',
    ]);
    expect(
      result.value.dnaGraph
        .getEdgesByKind('serves')
        .filter((edge) => edge.target === uiCapability?.id)
        .map((edge) => edge.source),
    ).toEqual(['file:src/components/app.ts', 'file:src/components/view.ts']);
  });

  it('links capability evidence found beyond the former analysis cap', async () => {
    const files = Array.from({ length: 501 }, (_, index) =>
      file(`src/module-${index.toString().padStart(3, '0')}.ts`, 1),
    );
    files.push(file('src/final-renderer.ts', 1, 'typescript', ['react']));
    const result = await new DNAEngine(createSilentLogger()).synthesize({
      repository: repository(files.length),
      files,
      dependencyGraph: graphFor(files),
      architecture: architecture(),
      knowledgeNodes: [],
      risks: [],
    });
    if (isErr(result)) throw result.error;

    const capability = result.value.capabilities.find((item) => item.name === 'UI Rendering');
    expect(capability?.implementedBy).toContain('file:src/final-renderer.ts');
    expect(result.value.dnaGraph.hasEdge('file:src/final-renderer.ts', capability?.id ?? '')).toBe(
      true,
    );
  });

  it('keeps incremental synthesis equivalent while reusing clean entities', async () => {
    const engine = new DNAEngine(createSilentLogger());
    const files = [file('src/one.ts', 10), file('src/two.ts', 20), file('src/three.ts', 30)];
    const input = {
      repository: repository(files.length),
      files,
      dependencyGraph: graphFor(files),
      architecture: architecture(),
      knowledgeNodes: [],
      risks: [],
    };
    const full = await engine.synthesize(input);
    if (isErr(full)) throw full.error;

    const changedFiles = [file('src/one.ts', 11), files[1]!, files[2]!];
    const incremental = await engine.synthesizeIncremental?.({
      input: { ...input, files: changedFiles },
      previous: full.value,
      dirtyEntityIds: ['file:src/one.ts'],
    });
    if (!incremental || isErr(incremental))
      throw incremental?.error ?? new Error('Incremental synthesis unavailable');

    const changedFull = await new DNAEngine(createSilentLogger()).synthesize({
      ...input,
      files: changedFiles,
    });
    if (isErr(changedFull)) throw changedFull.error;

    expect(incremental.value.profile.primaryLanguages).toEqual(
      changedFull.value.profile.primaryLanguages,
    );
    expect(incremental.value.entities.map(withoutEntityTimestamp)).toEqual(
      changedFull.value.entities.map(withoutEntityTimestamp),
    );
    expect(
      incremental.value.domains.map(({ detectedAt: _detectedAt, ...domain }) => domain),
    ).toEqual(changedFull.value.domains.map(({ detectedAt: _detectedAt, ...domain }) => domain));
    expect(
      incremental.value.capabilities.map(
        ({ detectedAt: _detectedAt, ...capability }) => capability,
      ),
    ).toEqual(
      changedFull.value.capabilities.map(
        ({ detectedAt: _detectedAt, ...capability }) => capability,
      ),
    );
    expect(normalizeGraphJson(incremental.value.dnaGraph.toJSON())).toEqual(
      normalizeGraphJson(changedFull.value.dnaGraph.toJSON()),
    );
  });
});

function withoutEntityTimestamp<T extends { lastAnalyzedAt: number }>(entity: T) {
  const { lastAnalyzedAt: _lastAnalyzedAt, ...stable } = entity;
  return stable;
}

function normalizeGraphJson(value: object): object {
  const graph = value as {
    options?: object;
    attributes?: object;
    nodes?: Array<Record<string, unknown>>;
    edges?: Array<Record<string, unknown>>;
  };
  return {
    options: graph.options,
    attributes: graph.attributes,
    nodes: graph.nodes,
    edges: graph.edges?.map(({ key: _key, ...edge }) => edge),
  };
}

function file(
  path: string,
  linesOfCode: number,
  language = 'typescript',
  importSources: string[] = [],
): FileDNA {
  return FileDNASchema.parse({
    id: path,
    path,
    language,
    hash: path,
    size: 1,
    linesOfCode,
    classIds: [],
    functionIds: [],
    imports: importSources.map((source) => ({
      source,
      specifiers: [],
      isTypeOnly: false,
      isDynamic: false,
    })),
    exports: [],
    comments: [],
    complexity: 1,
  });
}

function graphFor(files: FileDNA[]): RepositoryGraph {
  const graph = new RepositoryGraph();
  for (const item of files) {
    graph.addFileNode(item.path, {
      label: item.path.split('/').at(-1) ?? item.path,
      path: item.path,
    });
  }
  return graph;
}

function repository(fileCount: number) {
  return RepositoryDNASchema.parse({
    id: 'repository-id',
    name: 'fixture',
    rootPath: 'C:/fixture',
    languages: [
      { id: 'typescript', name: 'TypeScript', fileCount: fileCount - 1, percentage: 75 },
      { id: 'javascript', name: 'JavaScript', fileCount: 1, percentage: 25 },
    ],
    frameworks: [{ name: 'React', version: '18.0.0', confidence: 1 }],
    metadata: {
      hasReadme: false,
      hasLicense: false,
      hasGitIgnore: false,
      hasTsConfig: true,
      hasPackageJson: true,
    },
    totalFiles: fileCount,
    totalLinesOfCode: 100,
    createdAt: 1,
    updatedAt: 1,
  });
}

function architecture() {
  return ArchitectureDNASchema.parse({
    id: 'architecture-id',
    pattern: 'unknown',
    confidence: 0,
    detectedPatterns: [],
    layers: [],
    evidence: [],
    detectedAt: 1,
  });
}
