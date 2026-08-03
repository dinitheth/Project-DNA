import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PipelineStage, type IProjectDNAService } from '@project-dna/dna-core';
import {
  DNAEventNames,
  TOKENS,
  createSilentLogger,
  isErr,
  type DNAEventMap,
  type EventBus,
} from '@project-dna/shared';
import { createContainer } from '../container.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('ProjectDNAService integration', () => {
  it('runs the complete pipeline, exposes queries, snapshots, and refresh versions', async () => {
    const root = await fixtureRepository();
    const container = createContainer(createSilentLogger());
    const service = container.resolve<IProjectDNAService>(TOKENS.ProjectDNAService);
    const eventBus = container.resolve<EventBus<DNAEventMap>>(TOKENS.EventBus);
    const progress: string[] = [];
    const readyVersions: number[] = [];
    service.onProgress((item) => progress.push(item.stage));
    service.onReady((dna) => readyVersions.push(dna.version));

    const first = await service.analyze(root);
    if (isErr(first)) throw first.error;

    expect(first.value.version).toBe(1);
    expect(first.value.architecture.pattern).toBe('clean');
    expect(first.value.entityCount).toBeGreaterThanOrEqual(4);
    expect(first.value.knowledgeNodeCount).toBeGreaterThan(0);
    expect(first.value.riskCount).toBeGreaterThan(0);
    expect(first.value.risks.totalRisks).toBe(first.value.riskCount);
    expect(progress).toEqual(
      expect.arrayContaining([
        PipelineStage.Scanning,
        PipelineStage.SynthesizingDNA,
        PipelineStage.ComputingIntelligence,
        PipelineStage.ComputingEvolution,
        PipelineStage.Complete,
      ]),
    );
    expect(readyVersions).toEqual([1]);

    const entities = await service.getEntities({ limit: 10 });
    if (isErr(entities)) throw entities.error;
    expect(entities.value.length).toBeLessThanOrEqual(10);
    expect((await service.getDependencyGraph()).ok).toBe(true);
    expect((await service.getDNAGraph()).ok).toBe(true);
    expect(service.getArchitecture().pattern).toBe('clean');

    const second = await service.refresh();
    if (isErr(second)) throw second.error;
    expect(second.value.version).toBe(2);
    const history = await service.getHistory();
    if (isErr(history)) throw history.error;
    expect(history.value.map((snapshot) => snapshot.version)).toEqual([2, 1]);
    expect((await service.getDiff(1, 2)).ok).toBe(true);
    expect(eventBus.listenerCount(DNAEventNames.AnalysisProgress)).toBe(1);
  });

  it('returns explicit errors for refresh-before-analysis and cancellation', async () => {
    const service = createContainer(createSilentLogger()).resolve<IProjectDNAService>(
      TOKENS.ProjectDNAService,
    );
    expect(isErr(await service.refresh())).toBe(true);
    const controller = new AbortController();
    controller.abort();
    expect(isErr(await service.analyze('C:/cancelled', controller.signal))).toBe(true);
  });

  it('restores persisted aggregate data, graphs, history, and version continuity', async () => {
    const root = await fixtureRepository();
    const storageDirectory = await mkdtemp(path.join(tmpdir(), 'project-dna-service-storage-'));
    roots.push(storageDirectory);
    const storagePath = path.join(storageDirectory, 'project-dna.sqlite');

    const firstContainer = createContainer({
      logger: createSilentLogger(),
      storagePath,
    });
    const firstService = firstContainer.resolve<IProjectDNAService>(TOKENS.ProjectDNAService);
    const first = await firstService.analyze(root);
    if (isErr(first)) throw first.error;
    const second = await firstService.refresh();
    if (isErr(second)) throw second.error;
    await firstService.dispose();

    const restoredContainer = createContainer({
      logger: createSilentLogger(),
      storagePath,
    });
    const restoredService = restoredContainer.resolve<IProjectDNAService>(TOKENS.ProjectDNAService);
    const restored = await restoredService.restore(root);
    if (isErr(restored)) throw restored.error;

    expect(restored.value?.version).toBe(2);
    expect(restoredService.getArchitecture().pattern).toBe('clean');
    const entities = await restoredService.getEntities();
    if (isErr(entities)) throw entities.error;
    expect(entities.value.length).toBe(second.value.entityCount);
    const dependencyGraph = await restoredService.getDependencyGraph();
    if (isErr(dependencyGraph)) throw dependencyGraph.error;
    expect(dependencyGraph.value.nodeCount).toBeGreaterThan(0);
    const dnaGraph = await restoredService.getDNAGraph();
    if (isErr(dnaGraph)) throw dnaGraph.error;
    expect(dnaGraph.value.nodeCount).toBeGreaterThan(0);
    const history = await restoredService.getHistory();
    if (isErr(history)) throw history.error;
    expect(history.value.map((snapshot) => snapshot.version)).toEqual([2, 1]);
    expect((await restoredService.getDiff(1, 2)).ok).toBe(true);

    const third = await restoredService.refresh();
    if (isErr(third)) throw third.error;
    expect(third.value.version).toBe(3);
    await restoredService.dispose();
  });
});

async function fixtureRepository(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'project-dna-service-'));
  roots.push(root);
  const files: Record<string, string> = {
    'package.json': JSON.stringify({
      name: 'fixture',
      version: '1.0.0',
      dependencies: { react: '^18.0.0' },
    }),
    'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true } }),
    'src/domain/entities/order.ts': 'export interface Order { id: string; total: number }',
    'src/application/use-cases/create-order.ts':
      "import type { Order } from '../../domain/entities/order'; export function createOrder(id: string): Order { if (!id) throw new Error('id'); return { id, total: 0 }; }",
    'src/infrastructure/persistence/order-repository.ts':
      "import type { Order } from '../../domain/entities/order'; export function saveOrder(order: Order) { return order; }",
    'src/presentation/controllers/order-controller.ts':
      "import { createOrder } from '../../application/use-cases/create-order'; import { saveOrder } from '../../infrastructure/persistence/order-repository'; export function controller(id: string) { return saveOrder(createOrder(id)); }",
    'src/orphan-file.ts': 'export const orphan = true;',
  };
  for (const [relative, content] of Object.entries(files)) {
    const absolute = path.join(root, relative);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, content, 'utf8');
  }
  return root;
}
