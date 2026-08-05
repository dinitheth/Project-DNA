import { mkdir, mkdtemp, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PipelineStage,
  type IProjectDNAService,
  type IStoragePort,
  type ProjectDNA,
} from '@project-dna/dna-core';
import {
  DNAEventNames,
  TOKENS,
  createSilentLogger,
  isErr,
  type DNAEventMap,
  type EventBus,
} from '@project-dna/shared';
import { createContainer } from '../container.js';
import { buildSidebarData } from '../sidebar/sidebar-data.js';

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
    const reentrantAnalyses: Array<ReturnType<IProjectDNAService['analyze']>> = [];
    service.onProgress((item) => {
      progress.push(item.stage);
      if (item.stage === PipelineStage.Scanning && reentrantAnalyses.length === 0) {
        reentrantAnalyses.push(service.analyze(root));
      }
    });
    service.onReady((dna) => readyVersions.push(dna.version));

    const otherRoot = await fixtureRepository();
    const analysis = service.analyze(root);
    const conflicting = await service.analyze(otherRoot);
    const [first, concurrent] = await Promise.all([analysis, service.refresh()]);
    if (isErr(first)) throw first.error;
    if (isErr(concurrent)) throw concurrent.error;
    const reentrantAnalysis = reentrantAnalyses[0];
    if (!reentrantAnalysis) throw new Error('Re-entrant analysis was not started');
    const reentrant = await reentrantAnalysis;
    if (isErr(reentrant)) throw reentrant.error;

    expect(first.value.version).toBe(1);
    expect(concurrent.value.version).toBe(1);
    expect(reentrant.value.version).toBe(1);
    expect(isErr(conflicting)).toBe(true);
    expect(first.value.architecture.pattern).toBe('clean');
    expect(first.value.entityCount).toBeGreaterThanOrEqual(4);
    expect(first.value.knowledgeNodeCount).toBeGreaterThan(0);
    expect(first.value.riskCount).toBeGreaterThan(0);
    expect(first.value.risks.totalRisks).toBe(first.value.riskCount);
    expect(first.value.story.healthSummary).toContain('Heuristic health:');
    expect(first.value.story.architectureSummary).toContain('heuristic match');
    const coverage = first.value.analysisCoverage ?? {
      scanned: 0,
      parsed: 0,
      skipped: 0,
      failed: 0,
    };
    expect(coverage.parsed).toBe(first.value.entityCount);
    expect(coverage.parsed + coverage.skipped + coverage.failed).toBe(coverage.scanned);
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

    const sidebarData = await buildSidebarData(service);
    expect(sidebarData.repository.version).toBe(1);
    expect(sidebarData.repository.counts.entities).toBe(first.value.entityCount);
    expect(sidebarData.repository.coverage).toEqual(coverage);
    expect(sidebarData.repository.languages.every((language) => language.linesOfCode > 0)).toBe(
      true,
    );
    expect(sidebarData.architecture.pattern).toBe('clean');
    expect(sidebarData.dependencies.nodeCount).toBeGreaterThan(0);
    expect(sidebarData.dependencies.hotspots.length).toBeGreaterThan(0);
    expect(sidebarData.knowledge.nodes.length).toBeGreaterThan(0);
    expect(
      sidebarData.knowledge.capabilities.some((capability) => capability.implementationCount > 0),
    ).toBe(true);

    const entityIds = new Set(entities.value.map((entity) => entity.id));
    for (const entity of entities.value) {
      expect(entity.dependsOn.every((dependencyId) => entityIds.has(dependencyId))).toBe(true);
      expect(entity.dependedOnBy.every((dependencyId) => entityIds.has(dependencyId))).toBe(true);
    }

    const unchanged = await service.refresh();
    if (isErr(unchanged)) throw unchanged.error;
    expect(unchanged.value.version).toBe(1);
    const unchangedHistory = await service.getHistory();
    if (isErr(unchangedHistory)) throw unchangedHistory.error;
    expect(unchangedHistory.value.map((snapshot) => snapshot.version)).toEqual([1]);

    const changedPath = path.join(root, 'src/orphan-file.ts');
    await writeFile(changedPath, 'export const orphan = false;', 'utf8');
    eventBus.emit(DNAEventNames.RepositoryFilesChanged, {
      rootPath: root,
      watcherEpoch: 1,
      sequence: 1,
      observedAt: Date.now(),
      changes: [{ kind: 'modified', path: changedPath }],
    });
    const second = await service.refresh();
    if (isErr(second)) throw second.error;
    expect(second.value.version).toBe(2);
    const history = await service.getHistory();
    if (isErr(history)) throw history.error;
    expect(history.value.map((snapshot) => snapshot.version)).toEqual([2, 1]);
    expect((await service.getDiff(1, 2)).ok).toBe(true);
    expect(eventBus.listenerCount(DNAEventNames.AnalysisProgress)).toBe(1);

    const noOpAfterIncremental = await service.refresh();
    if (isErr(noOpAfterIncremental)) throw noOpAfterIncremental.error;
    expect(noOpAfterIncremental.value.version).toBe(2);
  }, 30_000);

  it('returns explicit errors for refresh-before-analysis and cancellation', async () => {
    const service = createContainer(createSilentLogger()).resolve<IProjectDNAService>(
      TOKENS.ProjectDNAService,
    );
    expect(isErr(await service.refresh())).toBe(true);
    const controller = new AbortController();
    controller.abort();
    expect(isErr(await service.analyze('C:/cancelled', controller.signal))).toBe(true);
  });

  it('automatically coalesces watcher bursts and ignores duplicate sequences', async () => {
    const root = await fixtureRepository();
    const container = createContainer(createSilentLogger());
    const service = container.resolve<IProjectDNAService>(TOKENS.ProjectDNAService);
    const eventBus = container.resolve<EventBus<DNAEventMap>>(TOKENS.EventBus);
    const initial = await service.analyze(root);
    if (isErr(initial)) throw initial.error;

    const firstPath = path.join(root, 'src/orphan-file.ts');
    const secondPath = path.join(root, 'src/domain/entities/order.ts');
    await writeFile(firstPath, 'export const orphan = false;', 'utf8');
    await writeFile(
      secondPath,
      'export interface Order { id: string; total: number; paid: boolean }',
      'utf8',
    );
    const ready = nextReady(service);
    eventBus.emit(DNAEventNames.RepositoryFilesChanged, {
      rootPath: root,
      watcherEpoch: 1,
      sequence: 1,
      observedAt: Date.now(),
      changes: [{ kind: 'modified', path: firstPath }],
    });
    eventBus.emit(DNAEventNames.RepositoryFilesChanged, {
      rootPath: root,
      watcherEpoch: 1,
      sequence: 2,
      observedAt: Date.now(),
      changes: [{ kind: 'modified', path: secondPath }],
    });

    expect((await ready).version).toBe(2);
    await writeFile(firstPath, 'export const orphan = "duplicate";', 'utf8');
    eventBus.emit(DNAEventNames.RepositoryFilesChanged, {
      rootPath: root,
      watcherEpoch: 1,
      sequence: 2,
      observedAt: Date.now(),
      changes: [{ kind: 'modified', path: firstPath }],
    });
    await delay(400);
    const current = service.getCurrent();
    if (isErr(current)) throw current.error;
    expect(current.value?.version).toBe(2);
    await service.dispose();
  }, 30_000);

  it('rejects a superseded candidate and publishes only the coherent successor', async () => {
    const root = await fixtureRepository();
    const container = createContainer(createSilentLogger());
    const service = container.resolve<IProjectDNAService>(TOKENS.ProjectDNAService);
    const eventBus = container.resolve<EventBus<DNAEventMap>>(TOKENS.EventBus);
    const initial = await service.analyze(root);
    if (isErr(initial)) throw initial.error;
    const readyVersions: number[] = [];
    service.onReady((dna) => readyVersions.push(dna.version));

    const firstPath = path.join(root, 'src/orphan-file.ts');
    const secondPath = path.join(root, 'src/domain/entities/order.ts');
    await writeFile(firstPath, 'export const orphan = false;', 'utf8');
    await writeFile(
      secondPath,
      'export interface Order { id: string; total: number; paid: boolean }',
      'utf8',
    );
    eventBus.emit(DNAEventNames.RepositoryFilesChanged, {
      rootPath: root,
      watcherEpoch: 1,
      sequence: 1,
      observedAt: Date.now(),
      changes: [{ kind: 'modified', path: firstPath }],
    });
    const unsubscribe = eventBus.once(DNAEventNames.IntelligenceStarted, () => {
      eventBus.emit(DNAEventNames.RepositoryFilesChanged, {
        rootPath: root,
        watcherEpoch: 1,
        sequence: 2,
        observedAt: Date.now(),
        changes: [{ kind: 'modified', path: secondPath }],
      });
    });
    const successor = nextReady(service);
    const superseded = await service.refresh();
    expect(isErr(superseded)).toBe(true);
    const retained = service.getCurrent();
    if (isErr(retained)) throw retained.error;
    expect(retained.value?.version).toBe(1);
    expect((await successor).version).toBe(2);
    expect(readyVersions).toEqual([2]);
    const history = await service.getHistory();
    if (isErr(history)) throw history.error;
    expect(history.value.map((snapshot) => snapshot.version)).toEqual([2, 1]);
    unsubscribe();
    await service.dispose();
  }, 30_000);

  it('matches a clean full analysis after incremental create, modify, rename, delete, and skip changes', async () => {
    const root = await fixtureRepository();
    const incrementalContainer = createContainer(createSilentLogger());
    const incrementalService = incrementalContainer.resolve<IProjectDNAService>(
      TOKENS.ProjectDNAService,
    );
    const incrementalEvents = incrementalContainer.resolve<EventBus<DNAEventMap>>(TOKENS.EventBus);
    const initial = await incrementalService.analyze(root);
    if (isErr(initial)) throw initial.error;

    const modifiedPath = path.join(root, 'src/orphan-file.ts');
    const createdPath = path.join(root, 'src/application/use-cases/list-orders.ts');
    const deletedPath = path.join(root, 'src/presentation/views/order-view.ts');
    const previousPath = path.join(root, 'src/infrastructure/persistence/order-repository.ts');
    const renamedPath = path.join(root, 'src/infrastructure/persistence/order-store.ts');
    const unsupportedPath = path.join(root, 'notes.rb');
    await writeFile(modifiedPath, 'export const orphan = false;', 'utf8');
    await writeFile(createdPath, 'export const listOrders = () => [];', 'utf8');
    await unlink(deletedPath);
    await rename(previousPath, renamedPath);
    await writeFile(unsupportedPath, 'puts "ignored by AST"', 'utf8');
    incrementalEvents.emit(DNAEventNames.RepositoryFilesChanged, {
      rootPath: root,
      watcherEpoch: 1,
      sequence: 1,
      observedAt: Date.now(),
      changes: [
        { kind: 'modified', path: modifiedPath },
        { kind: 'created', path: createdPath },
        { kind: 'deleted', path: deletedPath },
        { kind: 'deleted', path: previousPath },
        { kind: 'created', path: renamedPath },
        { kind: 'created', path: unsupportedPath },
      ],
    });
    const incremental = await incrementalService.refresh();
    if (isErr(incremental)) throw incremental.error;

    const fullContainer = createContainer(createSilentLogger());
    const fullService = fullContainer.resolve<IProjectDNAService>(TOKENS.ProjectDNAService);
    const full = await fullService.analyze(root);
    if (isErr(full)) throw full.error;

    await expectEquivalentServices(incrementalService, fullService);
    expect(incremental.value.analysisCoverage?.skipped).toBeGreaterThan(0);
    await incrementalService.dispose();
    await fullService.dispose();
  }, 30_000);

  it('uses a full-analysis fallback after watcher overflow', async () => {
    const root = await fixtureRepository();
    const container = createContainer(createSilentLogger());
    const service = container.resolve<IProjectDNAService>(TOKENS.ProjectDNAService);
    const eventBus = container.resolve<EventBus<DNAEventMap>>(TOKENS.EventBus);
    const initial = await service.analyze(root);
    if (isErr(initial)) throw initial.error;

    const addedPath = path.join(root, 'src/overflow-recovered.ts');
    await writeFile(addedPath, 'export const recovered = true;', 'utf8');
    const ready = nextReady(service);
    eventBus.emit(DNAEventNames.RepositoryWatcherInvalidated, {
      rootPath: root,
      watcherEpoch: 1,
      observedAt: Date.now(),
      reason: 'overflow',
    });
    const refreshed = await ready;
    expect(refreshed.version).toBe(2);
    expect(refreshed.entityCount).toBe(initial.value.entityCount + 1);
    await service.dispose();
  }, 30_000);

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
    const firstEventBus = firstContainer.resolve<EventBus<DNAEventMap>>(TOKENS.EventBus);
    const first = await firstService.analyze(root);
    if (isErr(first)) throw first.error;
    const changedPath = path.join(root, 'src/orphan-file.ts');
    await writeFile(changedPath, 'export const orphan = false;', 'utf8');
    firstEventBus.emit(DNAEventNames.RepositoryFilesChanged, {
      rootPath: root,
      watcherEpoch: 1,
      sequence: 1,
      observedAt: Date.now(),
      changes: [{ kind: 'modified', path: changedPath }],
    });
    const second = await firstService.refresh();
    if (isErr(second)) throw second.error;
    const storage = firstContainer.resolve<IStoragePort>(TOKENS.StoragePort);
    const aggregateKey = `${second.value.id}:v00000002`;
    const aggregate = await storage.load<Record<string, unknown>>(
      'project-dna:aggregate',
      aggregateKey,
    );
    if (isErr(aggregate)) throw aggregate.error;
    const legacyAggregate = { ...aggregate.value };
    delete legacyAggregate['analysisCoverage'];
    const savedLegacyAggregate = await storage.save(
      'project-dna:aggregate',
      aggregateKey,
      legacyAggregate,
    );
    if (isErr(savedLegacyAggregate)) throw savedLegacyAggregate.error;
    await firstService.dispose();

    const restoredContainer = createContainer({
      logger: createSilentLogger(),
      storagePath,
    });
    const restoredService = restoredContainer.resolve<IProjectDNAService>(TOKENS.ProjectDNAService);
    const restored = await restoredService.restore(root);
    if (isErr(restored)) throw restored.error;

    expect(restored.value?.version).toBe(2);
    expect(restored.value?.analysisCoverage).toEqual({
      scanned: 0,
      parsed: 0,
      skipped: 0,
      failed: 0,
    });
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
  }, 30_000);
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
    'src/presentation/views/order-view.ts':
      "import type { Order } from '../../domain/entities/order'; export function renderOrder(order: Order) { return order.id; }",
    'src/orphan-file.ts': 'export const orphan = true;',
  };
  for (const [relative, content] of Object.entries(files)) {
    const absolute = path.join(root, relative);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, content, 'utf8');
  }
  return root;
}

function nextReady(service: IProjectDNAService): Promise<ProjectDNA> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error('Timed out waiting for Project DNA publication'));
    }, 15_000);
    const unsubscribe = service.onReady((dna) => {
      clearTimeout(timeout);
      unsubscribe();
      resolve(dna);
    });
  });
}

function delay(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

async function expectEquivalentServices(
  incrementalService: IProjectDNAService,
  fullService: IProjectDNAService,
): Promise<void> {
  const [
    incrementalCurrent,
    fullCurrent,
    incrementalEntities,
    fullEntities,
    incrementalDomains,
    fullDomains,
    incrementalCapabilities,
    fullCapabilities,
    incrementalKnowledge,
    fullKnowledge,
    incrementalDependencyGraph,
    fullDependencyGraph,
    incrementalDnaGraph,
    fullDnaGraph,
  ] = await Promise.all([
    Promise.resolve(incrementalService.getCurrent()),
    Promise.resolve(fullService.getCurrent()),
    incrementalService.getEntities(),
    fullService.getEntities(),
    incrementalService.getDomains(),
    fullService.getDomains(),
    incrementalService.getCapabilities(),
    fullService.getCapabilities(),
    incrementalService.getKnowledge(),
    fullService.getKnowledge(),
    incrementalService.getDependencyGraph(),
    fullService.getDependencyGraph(),
    incrementalService.getDNAGraph(),
    fullService.getDNAGraph(),
  ]);
  if (isErr(incrementalCurrent)) throw incrementalCurrent.error;
  if (isErr(fullCurrent)) throw fullCurrent.error;
  if (isErr(incrementalEntities)) throw incrementalEntities.error;
  if (isErr(fullEntities)) throw fullEntities.error;
  if (isErr(incrementalDomains)) throw incrementalDomains.error;
  if (isErr(fullDomains)) throw fullDomains.error;
  if (isErr(incrementalCapabilities)) throw incrementalCapabilities.error;
  if (isErr(fullCapabilities)) throw fullCapabilities.error;
  if (isErr(incrementalKnowledge)) throw incrementalKnowledge.error;
  if (isErr(fullKnowledge)) throw fullKnowledge.error;
  if (isErr(incrementalDependencyGraph)) throw incrementalDependencyGraph.error;
  if (isErr(fullDependencyGraph)) throw fullDependencyGraph.error;
  if (isErr(incrementalDnaGraph)) throw incrementalDnaGraph.error;
  if (isErr(fullDnaGraph)) throw fullDnaGraph.error;

  expect(normalizeSemanticValue(incrementalCurrent.value)).toEqual(
    normalizeSemanticValue(fullCurrent.value),
  );
  expect(normalizeSemanticValue(incrementalEntities.value)).toEqual(
    normalizeSemanticValue(fullEntities.value),
  );
  expect(normalizeSemanticValue(incrementalDomains.value)).toEqual(
    normalizeSemanticValue(fullDomains.value),
  );
  expect(normalizeSemanticValue(incrementalCapabilities.value)).toEqual(
    normalizeSemanticValue(fullCapabilities.value),
  );
  expect(normalizeSemanticValue(incrementalKnowledge.value)).toEqual(
    normalizeSemanticValue(fullKnowledge.value),
  );
  expect(normalizeSemanticValue(incrementalDependencyGraph.value.toJSON())).toEqual(
    normalizeSemanticValue(fullDependencyGraph.value.toJSON()),
  );
  expect(normalizeSemanticValue(incrementalDnaGraph.value.toJSON())).toEqual(
    normalizeSemanticValue(fullDnaGraph.value.toJSON()),
  );
}

const VOLATILE_SEMANTIC_KEYS = new Set([
  'analyzedAt',
  'computedAt',
  'createdAt',
  'detectedAt',
  'durationMs',
  'generatedAt',
  'identifiedAt',
  'key',
  'lastAnalyzedAt',
  'lastComputedAt',
  'updatedAt',
  'version',
  'dependencyGraphRef',
  'dnaGraphRef',
]);

function normalizeSemanticValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeSemanticValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !VOLATILE_SEMANTIC_KEYS.has(key))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, normalizeSemanticValue(nested)]),
  );
}
