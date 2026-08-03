import { describe, expect, it } from 'vitest';
import { RepositoryDNASchema, RepositoryGraph } from '@project-dna/dna-core';
import { createSilentLogger, isErr } from '@project-dna/shared';
import { ArchitectureEngine } from '../architecture-engine.js';

describe('ArchitectureEngine', () => {
  it('detects Clean Architecture and infers its layers', async () => {
    const graph = graphWithFiles([
      'src/domain/entities/order.ts',
      'src/application/use-cases/create-order.ts',
      'src/infrastructure/persistence/order-repository.ts',
      'src/presentation/controllers/order-controller.ts',
    ]);

    const result = await infer(graph);

    expect(result.pattern).toBe('clean');
    expect(result.confidence).toBeGreaterThanOrEqual(0.85);
    expect(result.evidence.map((item) => item.rule)).toEqual(
      expect.arrayContaining([
        'clean.domain',
        'clean.application',
        'clean.infrastructure',
        'clean.presentation',
      ]),
    );
    expect(result.layers.map((layer) => layer.role)).toEqual(
      expect.arrayContaining(['domain', 'application', 'infrastructure', 'presentation']),
    );
  });

  it('detects MVC folder conventions', async () => {
    const result = await infer(
      graphWithFiles([
        'src/models/user.ts',
        'src/views/user-page.tsx',
        'src/controllers/user-controller.ts',
      ]),
    );

    expect(result.pattern).toBe('mvc');
    expect(result.confidence).toBe(0.84);
  });

  it('detects Hexagonal Architecture from ports, adapters, and domain core', async () => {
    const result = await infer(
      graphWithFiles([
        'src/domain/order.ts',
        'src/ports/order-repository.ts',
        'src/adapters/persistence/sql-order-repository.ts',
      ]),
    );

    expect(result.pattern).toBe('hexagonal');
    expect(result.confidence).toBe(0.9);
  });

  it('detects a multi-service topology', async () => {
    const result = await infer(
      graphWithFiles([
        'services/orders/src/index.ts',
        'services/users/src/index.ts',
        'services/payments/src/index.ts',
        'apps/api-gateway/src/index.ts',
      ]),
    );

    expect(result.pattern).toBe('microservice');
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
    expect(result.evidence.map((item) => item.rule)).toContain('microservice.gateway');
  });

  it('falls back to unknown when architectural signals are weak', async () => {
    const result = await infer(graphWithFiles(['src/index.ts', 'src/helpers.ts']));

    expect(result.pattern).toBe('unknown');
    expect(result.confidence).toBe(0);
    expect(result.evidence).toEqual([]);
    expect(result.detectedPatterns).toEqual([]);
  });

  it('uses deterministic ranking and IDs when patterns overlap', async () => {
    const graph = graphWithFiles([
      'src/domain/entity.ts',
      'src/application/use-cases/run.ts',
      'src/infrastructure/adapters/db.ts',
      'src/presentation/api/controller.ts',
      'src/ports/repository.ts',
    ]);

    const first = await infer(graph);
    const second = await infer(graph);

    expect(first.pattern).toBe('hexagonal');
    expect(first.detectedPatterns.slice(0, 2)).toEqual([
      { pattern: 'hexagonal', confidence: 0.9 },
      { pattern: 'clean', confidence: 0.9 },
    ]);
    expect(second.id).toBe(first.id);
  });

  it('uses dependency direction as supporting evidence', async () => {
    const graph = graphWithFiles([
      'src/domain/order.ts',
      'src/ports/order-repository.ts',
      'src/adapters/sql-order-repository.ts',
    ]);
    graph.addDependency('src/adapters/sql-order-repository.ts', 'src/ports/order-repository.ts', {
      type: 'import',
      isTypeOnly: false,
      specifierCount: 1,
      isExternal: false,
    });

    const result = await infer(graph);

    expect(result.pattern).toBe('hexagonal');
    expect(result.confidence).toBe(0.98);
    expect(result.evidence.map((item) => item.rule)).toContain('hexagonal.dependencyDirection');
  });

  it('honors cancellation', async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await new ArchitectureEngine(createSilentLogger()).inferArchitecture(
      graphWithFiles(['src/domain/entity.ts']),
      repository(),
      controller.signal,
    );

    expect(isErr(result)).toBe(true);
  });
});

async function infer(graph: RepositoryGraph) {
  const result = await new ArchitectureEngine(createSilentLogger()).inferArchitecture(
    graph,
    repository(),
  );
  if (isErr(result)) throw result.error;
  return result.value;
}

function graphWithFiles(paths: string[]): RepositoryGraph {
  const graph = new RepositoryGraph();
  for (const path of paths) {
    graph.addFileNode(path, { label: path.split('/').at(-1) ?? path, path });
  }
  return graph;
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
    totalFiles: 0,
    totalLinesOfCode: 0,
    createdAt: 1,
    updatedAt: 1,
  });
}
