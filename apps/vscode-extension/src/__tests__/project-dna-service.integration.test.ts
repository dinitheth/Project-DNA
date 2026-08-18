import { mkdir, mkdtemp, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AnalysisPerformanceStages,
  AnalysisPerformanceTracker,
  PipelineStage,
  ProjectDNASchema,
  createProjectDnaSnapshotHash,
  createProjectDnaSnapshotMetrics,
  type ITransactionalStoragePort,
  type IImpactEngine,
  type IProjectDNAService,
  type ImpactTarget,
  type IStoragePort,
  type ProjectDNA,
  type StorageBatch,
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
import { ImpactEngine } from '@project-dna/impact-engine';

interface TestStatement {
  get(...parameters: unknown[]): unknown;
  all(...parameters: unknown[]): unknown[];
  run(...parameters: unknown[]): unknown;
}

interface TestDatabase {
  exec(sql: string): void;
  prepare(sql: string): TestStatement;
  close(): void;
}

interface TestDatabaseConstructor {
  new (databasePath: string, options?: { readonly?: boolean }): TestDatabase;
}

const Database = createRequire(path.resolve('package.json'))(
  'better-sqlite3',
) as TestDatabaseConstructor;

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
    expect(await service.getImpact({ kind: 'file', path: 'missing.ts' })).toMatchObject({
      ok: false,
      error: { message: 'No complete Project DNA analysis is currently loaded' },
    });
    const controller = new AbortController();
    controller.abort();
    expect(isErr(await service.analyze('C:/cancelled', controller.signal))).toBe(true);
  });

  it('exposes deterministic serializable impact DTOs from one analysis version', async () => {
    const root = await fixtureRepository();
    const service = createContainer(createSilentLogger()).resolve<IProjectDNAService>(
      TOKENS.ProjectDNAService,
    );
    const analyzed = await service.analyze(root);
    if (isErr(analyzed)) throw analyzed.error;

    const target: ImpactTarget = { kind: 'file', path: 'src/domain/entities/order.ts' };
    const first = await service.getImpact(target);
    const second = await service.getImpact(target);
    if (isErr(first)) throw first.error;
    if (isErr(second)) throw second.error;
    expect(first.value.analysisVersion).toBe(analyzed.value.version);
    expect(JSON.stringify(first.value)).toBe(JSON.stringify(second.value));
    expect(first.value.score).toEqual(second.value.score);
    expect(first.value.evidence).toEqual(second.value.evidence);

    first.value.evidence.pop();
    const third = await service.getImpact(target);
    if (isErr(third)) throw third.error;
    expect(third.value.evidence.length).toBe(second.value.evidence.length);

    const missing = await service.getImpact({ kind: 'file', path: 'missing.ts' });
    expect(missing).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('does not resolve') },
    });
    const unsupported = await service.getImpact({ kind: 'class', id: 'class:Order' } as never);
    expect(unsupported).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('Unsupported impact target kind') },
    });
    const malformed = await service.getImpact({} as never);
    expect(malformed).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('Invalid impact target') },
    });
    await service.dispose();
  }, 30_000);

  it('rejects an impact query when a newer analysis starts during calculation', async () => {
    const root = await fixtureRepository();
    const serviceHolder: { value?: IProjectDNAService } = {};
    let refreshPromise: ReturnType<IProjectDNAService['refresh']> | undefined;
    const baseEngine = new ImpactEngine();
    const eventBusHolder: { value?: EventBus<DNAEventMap> } = {};
    const impactEngine: IImpactEngine = {
      getImpact(input, target, options, signal) {
        const eventBus = eventBusHolder.value;
        if (!eventBus) throw new Error('Missing test event bus');
        const changedPath = path.join(root, 'src/orphan-file.ts');
        eventBus.emit(DNAEventNames.RepositoryFilesChanged, {
          rootPath: root,
          watcherEpoch: 1,
          sequence: 1,
          observedAt: Date.now(),
          changes: [{ kind: 'modified', path: changedPath }],
        });
        if (!serviceHolder.value) throw new Error('Missing test service');
        refreshPromise = serviceHolder.value.refresh();
        return baseEngine.getImpact(input, target, options, signal);
      },
    };
    const container = createContainer({ logger: createSilentLogger(), impactEngine });
    const service = container.resolve<IProjectDNAService>(TOKENS.ProjectDNAService);
    serviceHolder.value = service;
    eventBusHolder.value = container.resolve<EventBus<DNAEventMap>>(TOKENS.EventBus);
    const analyzed = await service.analyze(root);
    if (isErr(analyzed)) throw analyzed.error;
    await writeFile(path.join(root, 'src/orphan-file.ts'), 'export const orphan = false;', 'utf8');
    const query = await service.getImpact({ kind: 'file', path: 'src/domain/entities/order.ts' });
    expect(query).toMatchObject({
      ok: false,
      error: { message: 'Analysis superseded by newer repository changes' },
    });
    if (refreshPromise) {
      const refreshed = await refreshPromise;
      if (isErr(refreshed)) throw refreshed.error;
      expect(refreshed.value.version).toBe(2);
    }
    await service.dispose();
  }, 30_000);

  it('propagates cancellation before and during service impact execution', async () => {
    const root = await fixtureRepository();
    const before = createContainer(createSilentLogger()).resolve<IProjectDNAService>(
      TOKENS.ProjectDNAService,
    );
    const beforeController = new AbortController();
    beforeController.abort();
    expect(
      await before.getImpact(
        { kind: 'file', path: 'order.ts' },
        undefined,
        beforeController.signal,
      ),
    ).toMatchObject({ ok: false, error: { message: 'Impact analysis cancelled' } });
    await before.dispose();

    const duringController = new AbortController();
    const baseEngine = new ImpactEngine();
    const impactEngine: IImpactEngine = {
      getImpact(input, target, options, signal) {
        duringController.abort();
        return baseEngine.getImpact(input, target, options, signal);
      },
    };
    const service = createContainer({
      logger: createSilentLogger(),
      impactEngine,
    }).resolve<IProjectDNAService>(TOKENS.ProjectDNAService);
    const analyzed = await service.analyze(root);
    if (isErr(analyzed)) throw analyzed.error;
    expect(
      await service.getImpact(
        { kind: 'file', path: 'src/domain/entities/order.ts' },
        undefined,
        duringController.signal,
      ),
    ).toMatchObject({ ok: false, error: { message: 'Impact analysis cancelled' } });
    await service.dispose();
  }, 30_000);

  it('retains complete risk observations across persistence and restore', async () => {
    const root = await fixtureRepository();
    const storageDirectory = await mkdtemp(path.join(tmpdir(), 'project-dna-risks-'));
    roots.push(storageDirectory);
    const storagePath = path.join(storageDirectory, 'project-dna.sqlite');
    const firstContainer = createContainer({ logger: createSilentLogger(), storagePath });
    const firstService = firstContainer.resolve<IProjectDNAService>(TOKENS.ProjectDNAService);
    const analyzed = await firstService.analyze(root);
    if (isErr(analyzed)) throw analyzed.error;
    const original = await firstService.getRiskNodes();
    if (isErr(original)) throw original.error;
    expect(original.value.length).toBe(analyzed.value.riskCount);
    expect(original.value.every((risk) => risk.id && risk.description)).toBe(true);
    await firstService.dispose();

    const restoredContainer = createContainer({ logger: createSilentLogger(), storagePath });
    const restoredService = restoredContainer.resolve<IProjectDNAService>(TOKENS.ProjectDNAService);
    const restored = await restoredService.restore(root);
    if (isErr(restored)) throw restored.error;
    expect(restored.value?.version).toBe(analyzed.value.version);
    const restoredRisks = await restoredService.getRiskNodes();
    if (isErr(restoredRisks)) throw restoredRisks.error;
    expect(restoredRisks.value).toEqual(original.value);
    await restoredService.dispose();
  }, 30_000);

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

  it('rolls back the complete candidate when atomic latest-pointer promotion fails', async () => {
    const root = await fixtureRepository();
    const storageDirectory = await mkdtemp(path.join(tmpdir(), 'project-dna-atomic-failure-'));
    roots.push(storageDirectory);
    const storagePath = path.join(storageDirectory, 'project-dna.sqlite');
    const container = createContainer({ logger: createSilentLogger(), storagePath });
    const service = container.resolve<IProjectDNAService>(TOKENS.ProjectDNAService);
    const eventBus = container.resolve<EventBus<DNAEventMap>>(TOKENS.EventBus);
    const readyVersions: number[] = [];
    service.onReady((dna) => readyVersions.push(dna.version));
    const initial = await service.analyze(root);
    if (isErr(initial)) throw initial.error;

    const injector = new Database(storagePath);
    injector.exec(`
      CREATE TRIGGER reject_latest_promotion
      BEFORE UPDATE OF value ON dna_store
      WHEN NEW.namespace = 'project-dna:latest'
      BEGIN
        SELECT RAISE(ABORT, 'injected latest-pointer failure');
      END;
    `);
    injector.close();

    const changedPath = path.join(root, 'src/orphan-file.ts');
    await writeFile(changedPath, 'export const orphan = "changed";', 'utf8');
    eventBus.emit(DNAEventNames.RepositoryFilesChanged, {
      rootPath: root,
      watcherEpoch: 1,
      sequence: 1,
      observedAt: Date.now(),
      changes: [{ kind: 'modified', path: changedPath }],
    });
    const failed = await service.refresh();

    expect(isErr(failed)).toBe(true);
    const current = service.getCurrent();
    if (isErr(current)) throw current.error;
    expect(current.value?.version).toBe(1);
    const history = await service.getHistory();
    if (isErr(history)) throw history.error;
    expect(history.value.map((snapshot) => snapshot.version)).toEqual([1]);
    expect(readyVersions).toEqual([1]);
    await service.dispose();

    const persisted = new Database(storagePath, { readonly: true });
    const latestRow = persisted
      .prepare('SELECT value FROM dna_store WHERE namespace = ? AND key = ?')
      .get('project-dna:latest', initial.value.id) as { value: string };
    expect(JSON.parse(latestRow.value)).toMatchObject({ version: 1 });
    const versionKey = `${initial.value.id}:v00000002`;
    expect(
      persisted
        .prepare('SELECT 1 FROM dna_store WHERE namespace = ? AND key = ?')
        .get('project-dna:aggregate', versionKey),
    ).toBeUndefined();
    expect(
      persisted
        .prepare('SELECT 1 FROM dna_store WHERE namespace = ? AND key = ?')
        .get('project-dna:version-manifest', versionKey),
    ).toBeUndefined();
    persisted.close();
  }, 30_000);

  it('quarantines an inconsistent persisted version instead of exposing it', async () => {
    const root = await fixtureRepository();
    const storageDirectory = await mkdtemp(path.join(tmpdir(), 'project-dna-integrity-'));
    roots.push(storageDirectory);
    const storagePath = path.join(storageDirectory, 'project-dna.sqlite');
    const firstContainer = createContainer({ logger: createSilentLogger(), storagePath });
    const firstService = firstContainer.resolve<IProjectDNAService>(TOKENS.ProjectDNAService);
    const analyzed = await firstService.analyze(root);
    if (isErr(analyzed)) throw analyzed.error;
    const storage = firstContainer.resolve<IStoragePort>(TOKENS.StoragePort);
    const versionKey = `${analyzed.value.id}:v00000001`;
    const aggregate = await storage.load<Record<string, unknown>>(
      'project-dna:aggregate',
      versionKey,
    );
    if (isErr(aggregate)) throw aggregate.error;
    const corrupted = await storage.save('project-dna:aggregate', versionKey, {
      ...aggregate.value,
      entityCount: analyzed.value.entityCount + 1,
    });
    if (isErr(corrupted)) throw corrupted.error;
    await firstService.dispose();

    const restoredContainer = createContainer({ logger: createSilentLogger(), storagePath });
    const restoredService = restoredContainer.resolve<IProjectDNAService>(TOKENS.ProjectDNAService);
    const restored = await restoredService.restore(root);
    if (isErr(restored)) throw restored.error;
    expect(restored.value).toBeNull();
    const current = restoredService.getCurrent();
    if (isErr(current)) throw current.error;
    expect(current.value).toBeNull();
    const restoredStorage = restoredContainer.resolve<IStoragePort>(TOKENS.StoragePort);
    const quarantine = await restoredStorage.list('project-dna:quarantine');
    if (isErr(quarantine)) throw quarantine.error;
    expect(quarantine.value).toHaveLength(1);
    expect(await versionRows(storagePath, versionKey)).toEqual([]);
    await restoredService.dispose();
  }, 30_000);

  it('quarantines corrupted versions and deterministically restores the newest valid version', async () => {
    const root = await fixtureRepository();
    const storageDirectory = await mkdtemp(path.join(tmpdir(), 'project-dna-recovery-corrupt-'));
    roots.push(storageDirectory);
    const storagePath = path.join(storageDirectory, 'project-dna.sqlite');
    const firstContainer = createContainer({ logger: createSilentLogger(), storagePath });
    const firstService = firstContainer.resolve<IProjectDNAService>(TOKENS.ProjectDNAService);
    const first = await firstService.analyze(root);
    if (isErr(first)) throw first.error;
    for (const [revision, content] of [
      [2, 'export const orphan = "second";'],
      [3, 'export const orphan = "third";'],
      [4, 'export const orphan = "fourth";'],
    ] as const) {
      await writeFile(path.join(root, 'src/orphan-file.ts'), content, 'utf8');
      const analyzed = await firstService.analyze(root);
      if (isErr(analyzed)) throw analyzed.error;
      expect(analyzed.value.version).toBe(revision);
    }
    const storage = firstContainer.resolve<IStoragePort>(TOKENS.StoragePort);
    const repositoryId = first.value.id;
    const v2 = `${repositoryId}:v00000002`;
    const v3 = `${repositoryId}:v00000003`;
    const v4 = `${repositoryId}:v00000004`;
    for (const result of [
      await storage.save('project-dna:version-manifest', v2, { formatVersion: 1 }),
      await storage.save('project-dna:dependency-graph', v3, null),
      await storage.save('project-dna:aggregate', v4, { corrupted: true }),
    ]) {
      if (isErr(result)) throw result.error;
    }
    await firstService.dispose();

    const recoveredContainer = createContainer({ logger: createSilentLogger(), storagePath });
    const recoveredService = recoveredContainer.resolve<IProjectDNAService>(
      TOKENS.ProjectDNAService,
    );
    const recovered = await recoveredService.restore(root);
    if (isErr(recovered)) throw recovered.error;
    expect(recovered.value?.version).toBe(1);
    const recoveredStorage = recoveredContainer.resolve<IStoragePort>(TOKENS.StoragePort);
    const latest = await recoveredStorage.load<Record<string, unknown>>(
      'project-dna:latest',
      repositoryId,
    );
    if (isErr(latest)) throw latest.error;
    expect(latest.value).toEqual({ version: 1, previousVersion: null, manifestFormat: 1 });
    const quarantine = await recoveredStorage.list('project-dna:quarantine');
    if (isErr(quarantine)) throw quarantine.error;
    expect(quarantine.value).toHaveLength(3);
    expect(quarantine.value).toEqual([...quarantine.value].sort());
    for (const versionKey of [v2, v3, v4]) {
      const remaining = await versionRows(storagePath, versionKey);
      expect(remaining).toEqual([]);
    }
    const quarantinedRecords = await Promise.all(
      quarantine.value.map(async (key) => {
        const loaded = await recoveredStorage.load<Record<string, unknown>>(
          'project-dna:quarantine',
          key,
        );
        if (isErr(loaded)) throw loaded.error;
        return loaded.value;
      }),
    );
    expect(quarantinedRecords.map((record) => record['versionKey']).sort()).toEqual([v2, v3, v4]);
    await recoveredService.dispose();

    const repeatedContainer = createContainer({ logger: createSilentLogger(), storagePath });
    const repeatedService = repeatedContainer.resolve<IProjectDNAService>(TOKENS.ProjectDNAService);
    const repeated = await repeatedService.restore(root);
    if (isErr(repeated)) throw repeated.error;
    expect(repeated.value?.version).toBe(1);
    const repeatedStorage = repeatedContainer.resolve<IStoragePort>(TOKENS.StoragePort);
    const repeatedQuarantine = await repeatedStorage.list('project-dna:quarantine');
    if (isErr(repeatedQuarantine)) throw repeatedQuarantine.error;
    expect(repeatedQuarantine.value).toEqual(quarantine.value);
    await repeatedService.dispose();
  }, 45_000);

  it('cleans interrupted legacy writes, orphan records, and repairs their latest pointer', async () => {
    const root = await fixtureRepository();
    const storageDirectory = await mkdtemp(path.join(tmpdir(), 'project-dna-recovery-partial-'));
    roots.push(storageDirectory);
    const storagePath = path.join(storageDirectory, 'project-dna.sqlite');
    const firstContainer = createContainer({ logger: createSilentLogger(), storagePath });
    const firstService = firstContainer.resolve<IProjectDNAService>(TOKENS.ProjectDNAService);
    const first = await firstService.analyze(root);
    if (isErr(first)) throw first.error;
    const storage = firstContainer.resolve<IStoragePort>(TOKENS.StoragePort);
    const v1 = `${first.value.id}:v00000001`;
    const v2 = `${first.value.id}:v00000002`;
    const aggregate = await storage.load<Record<string, unknown>>('project-dna:aggregate', v1);
    const graph = await storage.load<Record<string, unknown>>('project-dna:dependency-graph', v1);
    const snapshot = await storage.load<Record<string, unknown>>('project-dna:snapshots', v1);
    if (isErr(aggregate)) throw aggregate.error;
    if (isErr(graph)) throw graph.error;
    if (isErr(snapshot)) throw snapshot.error;
    for (const result of [
      await storage.save('project-dna:aggregate', v2, { ...aggregate.value, version: 2 }),
      await storage.save('project-dna:dependency-graph', v2, graph.value),
      await storage.save('project-dna:snapshots', v2, { ...snapshot.value, version: 2 }),
      await storage.save('project-dna:version-manifest', v2, { orphaned: true }),
      await storage.save('project-dna:latest', first.value.id, { version: 2 }),
    ]) {
      if (isErr(result)) throw result.error;
    }
    await firstService.dispose();

    const recoveredContainer = createContainer({ logger: createSilentLogger(), storagePath });
    const recoveredService = recoveredContainer.resolve<IProjectDNAService>(
      TOKENS.ProjectDNAService,
    );
    const recovered = await recoveredService.restore(root);
    if (isErr(recovered)) throw recovered.error;
    expect(recovered.value?.version).toBe(1);
    expect(await versionRows(storagePath, v2)).toEqual([]);
    const recoveredStorage = recoveredContainer.resolve<IStoragePort>(TOKENS.StoragePort);
    const latest = await recoveredStorage.load<Record<string, unknown>>(
      'project-dna:latest',
      first.value.id,
    );
    if (isErr(latest)) throw latest.error;
    expect(latest.value).toMatchObject({ version: 1 });
    const quarantine = await recoveredStorage.list('project-dna:quarantine');
    if (isErr(quarantine)) throw quarantine.error;
    expect(quarantine.value).toEqual([]);
    await recoveredService.dispose();
  }, 30_000);

  it('removes an orphan latest pointer when no complete version remains', async () => {
    const root = await fixtureRepository();
    const storageDirectory = await mkdtemp(path.join(tmpdir(), 'project-dna-recovery-orphan-'));
    roots.push(storageDirectory);
    const storagePath = path.join(storageDirectory, 'project-dna.sqlite');
    const firstContainer = createContainer({ logger: createSilentLogger(), storagePath });
    const firstService = firstContainer.resolve<IProjectDNAService>(TOKENS.ProjectDNAService);
    const first = await firstService.analyze(root);
    if (isErr(first)) throw first.error;
    const storage = firstContainer.resolve<IStoragePort>(TOKENS.StoragePort);
    const versionKey = `${first.value.id}:v00000001`;
    const rows = await versionRows(storagePath, versionKey);
    for (const namespace of rows) {
      const deleted = await storage.delete(namespace, versionKey);
      if (isErr(deleted)) throw deleted.error;
    }
    await firstService.dispose();

    const recoveredContainer = createContainer({ logger: createSilentLogger(), storagePath });
    const recoveredService = recoveredContainer.resolve<IProjectDNAService>(
      TOKENS.ProjectDNAService,
    );
    const recovered = await recoveredService.restore(root);
    if (isErr(recovered)) throw recovered.error;
    expect(recovered.value).toBeNull();
    const recoveredStorage = recoveredContainer.resolve<IStoragePort>(TOKENS.StoragePort);
    const latestExists = await recoveredStorage.exists('project-dna:latest', first.value.id);
    if (isErr(latestExists)) throw latestExists.error;
    expect(latestExists.value).toBe(false);
    await recoveredService.dispose();
  }, 30_000);

  it('quarantines a corrupted latest pointer and repairs it from validated records', async () => {
    const root = await fixtureRepository();
    const storageDirectory = await mkdtemp(path.join(tmpdir(), 'project-dna-recovery-pointer-'));
    roots.push(storageDirectory);
    const storagePath = path.join(storageDirectory, 'project-dna.sqlite');
    const firstContainer = createContainer({ logger: createSilentLogger(), storagePath });
    const firstService = firstContainer.resolve<IProjectDNAService>(TOKENS.ProjectDNAService);
    const first = await firstService.analyze(root);
    if (isErr(first)) throw first.error;
    await firstService.dispose();
    const database = new Database(storagePath);
    database
      .prepare('UPDATE dna_store SET value = ? WHERE namespace = ? AND key = ?')
      .run('{invalid-json', 'project-dna:latest', first.value.id);
    database.close();

    const recoveredContainer = createContainer({ logger: createSilentLogger(), storagePath });
    const recoveredService = recoveredContainer.resolve<IProjectDNAService>(
      TOKENS.ProjectDNAService,
    );
    const recovered = await recoveredService.restore(root);
    if (isErr(recovered)) throw recovered.error;
    expect(recovered.value?.version).toBe(1);
    const recoveredStorage = recoveredContainer.resolve<IStoragePort>(TOKENS.StoragePort);
    const latest = await recoveredStorage.load<Record<string, unknown>>(
      'project-dna:latest',
      first.value.id,
    );
    if (isErr(latest)) throw latest.error;
    expect(latest.value).toEqual({ version: 1, previousVersion: null, manifestFormat: 1 });
    const quarantine = await recoveredStorage.list('project-dna:quarantine');
    if (isErr(quarantine)) throw quarantine.error;
    expect(quarantine.value).toHaveLength(1);
    const quarantined = await recoveredStorage.load<Record<string, unknown>>(
      'project-dna:quarantine',
      quarantine.value[0]!,
    );
    if (isErr(quarantined)) throw quarantined.error;
    expect(quarantined.value).toMatchObject({
      kind: 'latest-pointer',
      repositoryId: first.value.id,
      record: {
        namespace: 'project-dna:latest',
        key: first.value.id,
        status: 'unreadable',
        rawValue: '{invalid-json',
        metadata: {
          createdAt: expect.any(Number),
          updatedAt: expect.any(Number),
        },
      },
    });
    await recoveredService.dispose();
  }, 30_000);

  it('preserves the recovered version when the next transactional promotion rolls back', async () => {
    const root = await fixtureRepository();
    const storageDirectory = await mkdtemp(path.join(tmpdir(), 'project-dna-recovery-rollback-'));
    roots.push(storageDirectory);
    const storagePath = path.join(storageDirectory, 'project-dna.sqlite');
    const firstContainer = createContainer({ logger: createSilentLogger(), storagePath });
    const firstService = firstContainer.resolve<IProjectDNAService>(TOKENS.ProjectDNAService);
    const first = await firstService.analyze(root);
    if (isErr(first)) throw first.error;
    await writeFile(
      path.join(root, 'src/orphan-file.ts'),
      'export const orphan = "second";',
      'utf8',
    );
    const second = await firstService.analyze(root);
    if (isErr(second)) throw second.error;
    const firstStorage = firstContainer.resolve<IStoragePort>(TOKENS.StoragePort);
    const corrupted = await firstStorage.save(
      'project-dna:aggregate',
      `${first.value.id}:v00000002`,
      { corrupted: true },
    );
    if (isErr(corrupted)) throw corrupted.error;
    await firstService.dispose();

    const recoveredContainer = createContainer({ logger: createSilentLogger(), storagePath });
    const recoveredService = recoveredContainer.resolve<IProjectDNAService>(
      TOKENS.ProjectDNAService,
    );
    const recovered = await recoveredService.restore(root);
    if (isErr(recovered)) throw recovered.error;
    expect(recovered.value?.version).toBe(1);

    const injector = new Database(storagePath);
    injector.exec(`
      CREATE TRIGGER reject_recovered_latest_promotion
      BEFORE UPDATE OF value ON dna_store
      WHEN NEW.namespace = 'project-dna:latest'
      BEGIN
        SELECT RAISE(ABORT, 'injected post-recovery promotion failure');
      END;
    `);
    injector.close();
    await writeFile(
      path.join(root, 'src/orphan-file.ts'),
      'export const orphan = "third";',
      'utf8',
    );
    const failed = await recoveredService.analyze(root);
    expect(isErr(failed)).toBe(true);
    const current = recoveredService.getCurrent();
    if (isErr(current)) throw current.error;
    expect(current.value?.version).toBe(1);
    const recoveredStorage = recoveredContainer.resolve<IStoragePort>(TOKENS.StoragePort);
    const latest = await recoveredStorage.load<Record<string, unknown>>(
      'project-dna:latest',
      first.value.id,
    );
    if (isErr(latest)) throw latest.error;
    expect(latest.value).toMatchObject({ version: 1 });
    expect(await versionRows(storagePath, `${first.value.id}:v00000002`)).toEqual([]);
    await recoveredService.dispose();
  }, 45_000);

  it('restores M0-M2 legacy data and promotes a complete interrupted legacy write', async () => {
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
    const latest = await storage.load<Record<string, unknown>>(
      'project-dna:latest',
      second.value.id,
    );
    const manifest = await storage.load<Record<string, unknown>>(
      'project-dna:version-manifest',
      aggregateKey,
    );
    if (isErr(latest)) throw latest.error;
    if (isErr(manifest)) throw manifest.error;
    expect(latest.value).toEqual({ version: 2, previousVersion: 1, manifestFormat: 1 });
    expect(manifest.value).toMatchObject({
      formatVersion: 1,
      repositoryId: second.value.id,
      version: 2,
      versionKey: aggregateKey,
      previousVersion: 1,
    });
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
    const removedManifest = await storage.delete('project-dna:version-manifest', aggregateKey);
    if (isErr(removedManifest)) throw removedManifest.error;
    const savedLegacyLatest = await storage.save('project-dna:latest', second.value.id, {
      version: 1,
    });
    if (isErr(savedLegacyLatest)) throw savedLegacyLatest.error;
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
    const repairedLatest = await restoredContainer
      .resolve<IStoragePort>(TOKENS.StoragePort)
      .load<Record<string, unknown>>('project-dna:latest', second.value.id);
    if (isErr(repairedLatest)) throw repairedLatest.error;
    expect(repairedLatest.value).toEqual({ version: 2 });

    const third = await restoredService.refresh();
    if (isErr(third)) throw third.error;
    expect(third.value.version).toBe(3);
    const restoredStorage = restoredContainer.resolve<IStoragePort>(TOKENS.StoragePort);
    const thirdManifest = await restoredStorage.load(
      'project-dna:version-manifest',
      `${third.value.id}:v00000003`,
    );
    if (isErr(thirdManifest)) throw thirdManifest.error;
    await restoredService.dispose();
  }, 30_000);

  it('recovers a complete interrupted first legacy write without a root index', async () => {
    const { root, storagePath, repositoryId, versionKey } = await persistedFixture();
    const database = new Database(storagePath);
    database
      .prepare('DELETE FROM dna_store WHERE namespace IN (?, ?, ?)')
      .run('project-dna:root-index', 'project-dna:latest', 'project-dna:version-manifest');
    database.close();

    const container = createContainer({ logger: createSilentLogger(), storagePath });
    const service = container.resolve<IProjectDNAService>(TOKENS.ProjectDNAService);
    const restored = await service.restore(root);
    if (isErr(restored)) throw restored.error;
    expect(restored.value?.version).toBe(1);

    const storage = container.resolve<IStoragePort>(TOKENS.StoragePort);
    const rootIndex = await storage.load<string>('project-dna:root-index', normalizeRoot(root));
    const latest = await storage.load<Record<string, unknown>>('project-dna:latest', repositoryId);
    if (isErr(rootIndex)) throw rootIndex.error;
    if (isErr(latest)) throw latest.error;
    expect(rootIndex.value).toBe(repositoryId);
    expect(latest.value).toEqual({ version: 1 });
    expect(await versionRows(storagePath, versionKey)).toHaveLength(9);
    await service.dispose();
  }, 20_000);

  it('removes an incomplete rootless first legacy write so version one can be retried', async () => {
    const { root, storagePath, versionKey } = await persistedFixture();
    const database = new Database(storagePath);
    database
      .prepare('DELETE FROM dna_store WHERE namespace IN (?, ?, ?)')
      .run('project-dna:root-index', 'project-dna:latest', 'project-dna:version-manifest');
    database
      .prepare('DELETE FROM dna_store WHERE namespace = ? AND key = ?')
      .run('project-dna:entities', versionKey);
    database.close();

    const container = createContainer({ logger: createSilentLogger(), storagePath });
    const service = container.resolve<IProjectDNAService>(TOKENS.ProjectDNAService);
    const restored = await service.restore(root);
    if (isErr(restored)) throw restored.error;
    expect(restored.value).toBeNull();
    expect(await versionRows(storagePath, versionKey)).toEqual([]);
    const rootIndex = await container
      .resolve<IStoragePort>(TOKENS.StoragePort)
      .exists('project-dna:root-index', normalizeRoot(root));
    if (isErr(rootIndex)) throw rootIndex.error;
    expect(rootIndex.value).toBe(false);

    const retried = await service.analyze(root);
    if (isErr(retried)) throw retried.error;
    expect(retried.value.version).toBe(1);
    await service.dispose();
  }, 20_000);

  it('quarantines a missing M3 manifest instead of downgrading the latest pointer', async () => {
    const { root, storagePath, repositoryId, versionKey } = await persistedFixture();
    const database = new Database(storagePath);
    database
      .prepare('DELETE FROM dna_store WHERE namespace = ? AND key = ?')
      .run('project-dna:version-manifest', versionKey);
    database.close();

    const container = createContainer({ logger: createSilentLogger(), storagePath });
    const service = container.resolve<IProjectDNAService>(TOKENS.ProjectDNAService);
    const restored = await service.restore(root);
    if (isErr(restored)) throw restored.error;
    expect(restored.value).toBeNull();

    const storage = container.resolve<IStoragePort>(TOKENS.StoragePort);
    const quarantine = await storage.list('project-dna:quarantine');
    const latest = await storage.exists('project-dna:latest', repositoryId);
    if (isErr(quarantine)) throw quarantine.error;
    if (isErr(latest)) throw latest.error;
    expect(quarantine.value).toHaveLength(1);
    expect(latest.value).toBe(false);
    await service.dispose();
  }, 20_000);

  it('keeps M3 pointer semantics when a missing latest manifest falls back', async () => {
    const root = await fixtureRepository();
    const storageDirectory = await mkdtemp(path.join(tmpdir(), 'project-dna-manifest-fallback-'));
    roots.push(storageDirectory);
    const storagePath = path.join(storageDirectory, 'project-dna.sqlite');
    const firstContainer = createContainer({ logger: createSilentLogger(), storagePath });
    const firstService = firstContainer.resolve<IProjectDNAService>(TOKENS.ProjectDNAService);
    const first = await firstService.analyze(root);
    if (isErr(first)) throw first.error;
    await writeFile(path.join(root, 'src/orphan-file.ts'), 'export const orphan = 2;', 'utf8');
    const second = await firstService.analyze(root);
    if (isErr(second)) throw second.error;
    const secondKey = `${second.value.id}:v00000002`;
    const storage = firstContainer.resolve<IStoragePort>(TOKENS.StoragePort);
    const removed = await storage.delete('project-dna:version-manifest', secondKey);
    if (isErr(removed)) throw removed.error;
    await firstService.dispose();

    const recoveredContainer = createContainer({ logger: createSilentLogger(), storagePath });
    const recoveredService = recoveredContainer.resolve<IProjectDNAService>(
      TOKENS.ProjectDNAService,
    );
    const recovered = await recoveredService.restore(root);
    if (isErr(recovered)) throw recovered.error;
    expect(recovered.value?.version).toBe(1);
    const latest = await recoveredContainer
      .resolve<IStoragePort>(TOKENS.StoragePort)
      .load<Record<string, unknown>>('project-dna:latest', first.value.id);
    if (isErr(latest)) throw latest.error;
    expect(latest.value).toEqual({ version: 1, previousVersion: null, manifestFormat: 1 });
    await recoveredService.dispose();
  }, 25_000);

  it('does not let a future orphan manifest mask a missing latest M3 manifest', async () => {
    const fixture = await persistedHistory(3);
    const thirdKey = `${fixture.repositoryId}:v00000003`;
    const orphanKey = `${fixture.repositoryId}:v00000100`;
    const database = new Database(fixture.storagePath);
    database
      .prepare('DELETE FROM dna_store WHERE namespace = ? AND key = ?')
      .run('project-dna:version-manifest', thirdKey);
    database
      .prepare(
        'INSERT INTO dna_store (namespace, key, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(
        'project-dna:version-manifest',
        orphanKey,
        JSON.stringify({ formatVersion: 1, version: 100 }),
        Date.now(),
        Date.now(),
      );
    database.close();

    const container = createContainer({
      logger: createSilentLogger(),
      storagePath: fixture.storagePath,
    });
    const service = container.resolve<IProjectDNAService>(TOKENS.ProjectDNAService);
    const restored = await service.restore(fixture.root);
    if (isErr(restored)) throw restored.error;
    expect(restored.value?.version).toBe(2);
    expect(await versionRows(fixture.storagePath, thirdKey)).toEqual([]);
    const latest = await container
      .resolve<IStoragePort>(TOKENS.StoragePort)
      .load<Record<string, unknown>>('project-dna:latest', fixture.repositoryId);
    if (isErr(latest)) throw latest.error;
    expect(latest.value).toEqual({ version: 2, previousVersion: 1, manifestFormat: 1 });
    await service.dispose();
  }, 30_000);

  it('quarantines a legacy fallback whose predecessor is not valid', async () => {
    const fixture = await persistedHistory(5);
    const thirdKey = `${fixture.repositoryId}:v00000003`;
    const fourthKey = `${fixture.repositoryId}:v00000004`;
    const fifthKey = `${fixture.repositoryId}:v00000005`;
    const database = new Database(fixture.storagePath);
    database.prepare('DELETE FROM dna_store WHERE key = ?').run(thirdKey);
    database
      .prepare('DELETE FROM dna_store WHERE namespace = ? AND key = ?')
      .run('project-dna:version-manifest', fourthKey);
    database
      .prepare('DELETE FROM dna_store WHERE namespace = ? AND key = ?')
      .run('project-dna:version-manifest', fifthKey);
    database.close();

    const container = createContainer({
      logger: createSilentLogger(),
      storagePath: fixture.storagePath,
    });
    const service = container.resolve<IProjectDNAService>(TOKENS.ProjectDNAService);
    const restored = await service.restore(fixture.root);
    if (isErr(restored)) throw restored.error;
    expect(restored.value?.version).toBe(2);
    expect(await versionRows(fixture.storagePath, fourthKey)).toEqual([]);
    expect(await versionRows(fixture.storagePath, fifthKey)).toEqual([]);
    const quarantine = await container
      .resolve<IStoragePort>(TOKENS.StoragePort)
      .list('project-dna:quarantine');
    if (isErr(quarantine)) throw quarantine.error;
    expect(quarantine.value).toHaveLength(2);
    await service.dispose();
  }, 45_000);

  it('rejects a fabricated parent on a version-one snapshot', async () => {
    const fixture = await persistedFixture();
    mutateStoredJson(fixture.storagePath, 'project-dna:snapshots', fixture.versionKey, (value) => ({
      ...asRecord(value),
      parentSnapshotId: 'snapshot:missing-parent',
    }));

    const container = createContainer({
      logger: createSilentLogger(),
      storagePath: fixture.storagePath,
    });
    const service = container.resolve<IProjectDNAService>(TOKENS.ProjectDNAService);
    const restored = await service.restore(fixture.root);
    if (isErr(restored)) throw restored.error;
    expect(restored.value).toBeNull();
    await service.dispose();
  }, 20_000);

  it.each([
    ['complexity and coupling', corruptComplexityWithMatchingSnapshot],
    ['health', corruptHealthWithMatchingSnapshot],
    ['risk exposure', corruptRiskWithMatchingSnapshot],
  ] as const)(
    'rejects coordinated aggregate and snapshot corruption in %s',
    async (_label, corrupt) => {
      const fixture = await persistedFixture();
      corrupt(fixture.storagePath, fixture.versionKey);
      const container = createContainer({
        logger: createSilentLogger(),
        storagePath: fixture.storagePath,
      });
      const service = container.resolve<IProjectDNAService>(TOKENS.ProjectDNAService);
      const restored = await service.restore(fixture.root);
      if (isErr(restored)) throw restored.error;
      expect(restored.value).toBeNull();
      await service.dispose();
    },
    20_000,
  );

  it.each([
    ['node attributes', corruptDnaGraphNodeAttributes],
    ['edge attributes', corruptDnaGraphEdgeAttributes],
  ] as const)(
    'rejects corrupted DNA graph semantic %s',
    async (_label, corrupt) => {
      const fixture = await persistedFixture();
      corrupt(fixture.storagePath, fixture.versionKey);
      const container = createContainer({
        logger: createSilentLogger(),
        storagePath: fixture.storagePath,
      });
      const service = container.resolve<IProjectDNAService>(TOKENS.ProjectDNAService);
      const restored = await service.restore(fixture.root);
      if (isErr(restored)) throw restored.error;
      expect(restored.value).toBeNull();
      await service.dispose();
    },
    20_000,
  );

  it.each([
    ['unreadable JSON', '{not-json'],
    ['incorrect repository ID', JSON.stringify('incorrect-repository-id')],
  ] as const)(
    'recovers through a root index containing %s',
    async (_label, rawValue) => {
      const fixture = await persistedFixture();
      const database = new Database(fixture.storagePath);
      database
        .prepare('UPDATE dna_store SET value = ? WHERE namespace = ? AND key = ?')
        .run(rawValue, 'project-dna:root-index', normalizeRoot(fixture.root));
      database.close();

      const container = createContainer({
        logger: createSilentLogger(),
        storagePath: fixture.storagePath,
      });
      const service = container.resolve<IProjectDNAService>(TOKENS.ProjectDNAService);
      const restored = await service.restore(fixture.root);
      if (isErr(restored)) throw restored.error;
      expect(restored.value?.version).toBe(1);
      const rootIndex = await container
        .resolve<IStoragePort>(TOKENS.StoragePort)
        .load<string>('project-dna:root-index', normalizeRoot(fixture.root));
      if (isErr(rootIndex)) throw rootIndex.error;
      expect(rootIndex.value).toBe(fixture.repositoryId);
      await service.dispose();
    },
    20_000,
  );

  it('does not clean an incomplete version that changes after inspection', async () => {
    const fixture = await persistedFixture();
    const database = new Database(fixture.storagePath);
    const entityRow = database
      .prepare('SELECT value FROM dna_store WHERE namespace = ? AND key = ?')
      .get('project-dna:entities', fixture.versionKey) as { value: string } | undefined;
    if (!entityRow) throw new Error('Missing persisted entity fixture');
    database
      .prepare('DELETE FROM dna_store WHERE namespace = ? AND key = ?')
      .run('project-dna:entities', fixture.versionKey);
    database.close();

    const container = createContainer({
      logger: createSilentLogger(),
      storagePath: fixture.storagePath,
    });
    const storage = container.resolve<ITransactionalStoragePort>(TOKENS.StoragePort);
    const originalApply = storage.applyAtomically.bind(storage);
    let injected = false;
    Object.defineProperty(storage, 'applyAtomically', {
      configurable: true,
      value: async (batch: StorageBatch) => {
        if (
          !injected &&
          batch.mutations.some(
            (mutation) => mutation.type === 'delete' && mutation.key === fixture.versionKey,
          )
        ) {
          injected = true;
          const completed = await storage.save(
            'project-dna:entities',
            fixture.versionKey,
            JSON.parse(entityRow.value) as unknown,
          );
          if (isErr(completed)) throw completed.error;
        }
        return originalApply(batch);
      },
    });

    const service = container.resolve<IProjectDNAService>(TOKENS.ProjectDNAService);
    expect(isErr(await service.restore(fixture.root))).toBe(true);
    const preserved = await storage.exists('project-dna:entities', fixture.versionKey);
    if (isErr(preserved)) throw preserved.error;
    expect(preserved.value).toBe(true);
    expect(await versionRows(fixture.storagePath, fixture.versionKey)).toHaveLength(10);
    await service.dispose();
  }, 20_000);

  it('repairs a formatted latest pointer using exact raw evidence', async () => {
    const fixture = await persistedHistory(2);
    const database = new Database(fixture.storagePath);
    database
      .prepare('UPDATE dna_store SET value = ? WHERE namespace = ? AND key = ?')
      .run(
        '{\n  "manifestFormat": 1,\n  "previousVersion": null,\n  "version": 1\n}',
        'project-dna:latest',
        fixture.repositoryId,
      );
    database.close();

    const container = createContainer({
      logger: createSilentLogger(),
      storagePath: fixture.storagePath,
    });
    const service = container.resolve<IProjectDNAService>(TOKENS.ProjectDNAService);
    const restored = await service.restore(fixture.root);
    if (isErr(restored)) throw restored.error;
    expect(restored.value?.version).toBe(2);
    const latest = await container
      .resolve<IStoragePort>(TOKENS.StoragePort)
      .load<Record<string, unknown>>('project-dna:latest', fixture.repositoryId);
    if (isErr(latest)) throw latest.error;
    expect(latest.value).toEqual({ version: 2, previousVersion: 1, manifestFormat: 1 });
    await service.dispose();
  }, 25_000);

  it.each([
    ['dependency graph', corruptDependencyGraph],
    ['DNA graph', corruptDnaGraph],
    ['capability references', corruptCapabilityReference],
    ['domain references', corruptDomainReference],
    ['domain dependency references', corruptDomainDependencyReference],
    ['knowledge references', corruptKnowledgeReference],
    ['duplicate knowledge IDs', corruptDuplicateKnowledgeId],
    ['aggregate semantics', corruptAggregateSemantics],
    ['snapshot hash', corruptSnapshotHash],
    ['snapshot metrics', corruptSnapshotMetrics],
  ] as const)(
    'quarantines schema-valid corrupted %s',
    async (_label, corrupt) => {
      const fixture = await persistedFixture();
      await corrupt(fixture.storagePath, fixture.versionKey);

      const container = createContainer({
        logger: createSilentLogger(),
        storagePath: fixture.storagePath,
      });
      const service = container.resolve<IProjectDNAService>(TOKENS.ProjectDNAService);
      const restored = await service.restore(fixture.root);
      if (isErr(restored)) throw restored.error;
      expect(restored.value).toBeNull();
      const quarantine = await container
        .resolve<IStoragePort>(TOKENS.StoragePort)
        .list('project-dna:quarantine');
      if (isErr(quarantine)) throw quarantine.error;
      expect(quarantine.value).toHaveLength(1);
      await service.dispose();
    },
    20_000,
  );

  it('uses compare-and-set when recovery repairs the latest pointer', async () => {
    const { root, storagePath, repositoryId } = await persistedFixture();
    const database = new Database(storagePath);
    database
      .prepare('DELETE FROM dna_store WHERE namespace = ? AND key = ?')
      .run('project-dna:latest', repositoryId);
    database.close();

    const container = createContainer({ logger: createSilentLogger(), storagePath });
    const storage = container.resolve<ITransactionalStoragePort>(TOKENS.StoragePort);
    const originalApply = storage.applyAtomically.bind(storage);
    let injected = false;
    Object.defineProperty(storage, 'applyAtomically', {
      configurable: true,
      value: async (batch: StorageBatch) => {
        if (
          !injected &&
          batch.mutations.some(
            (mutation) =>
              mutation.namespace === 'project-dna:latest' && mutation.key === repositoryId,
          )
        ) {
          injected = true;
          const raced = await storage.save('project-dna:latest', repositoryId, { version: 99 });
          if (isErr(raced)) throw raced.error;
        }
        return originalApply(batch);
      },
    });

    const service = container.resolve<IProjectDNAService>(TOKENS.ProjectDNAService);
    expect(isErr(await service.restore(root))).toBe(true);
    const latest = await storage.load<{ version: number }>('project-dna:latest', repositoryId);
    if (isErr(latest)) throw latest.error;
    expect(latest.value.version).toBe(99);
    await service.dispose();
  }, 20_000);

  it('rejects a fabricated manifest version chain', async () => {
    const root = await fixtureRepository();
    const storageDirectory = await mkdtemp(path.join(tmpdir(), 'project-dna-chain-'));
    roots.push(storageDirectory);
    const storagePath = path.join(storageDirectory, 'project-dna.sqlite');
    const firstContainer = createContainer({ logger: createSilentLogger(), storagePath });
    const firstService = firstContainer.resolve<IProjectDNAService>(TOKENS.ProjectDNAService);
    const first = await firstService.analyze(root);
    if (isErr(first)) throw first.error;
    for (const version of [2, 3]) {
      await writeFile(
        path.join(root, 'src/orphan-file.ts'),
        `export const orphan = ${version};`,
        'utf8',
      );
      const analyzed = await firstService.analyze(root);
      if (isErr(analyzed)) throw analyzed.error;
    }
    await firstService.dispose();
    const thirdKey = `${first.value.id}:v00000003`;
    mutateStoredJson(storagePath, 'project-dna:version-manifest', thirdKey, (value) => ({
      ...asRecord(value),
      previousVersion: 1,
    }));

    const recoveredContainer = createContainer({ logger: createSilentLogger(), storagePath });
    const recoveredService = recoveredContainer.resolve<IProjectDNAService>(
      TOKENS.ProjectDNAService,
    );
    const recovered = await recoveredService.restore(root);
    if (isErr(recovered)) throw recovered.error;
    expect(recovered.value?.version).toBe(2);
    await recoveredService.dispose();
  }, 30_000);

  it('recovers a long history without deserializing historical heavy namespaces', async () => {
    const versionCount = 25;
    const root = await fixtureRepository();
    const storageDirectory = await mkdtemp(path.join(tmpdir(), 'project-dna-history-'));
    roots.push(storageDirectory);
    const storagePath = path.join(storageDirectory, 'project-dna.sqlite');
    const container = createContainer({ logger: createSilentLogger(), storagePath });
    const service = container.resolve<IProjectDNAService>(TOKENS.ProjectDNAService);
    const first = await service.analyze(root);
    if (isErr(first)) throw first.error;
    for (let version = 2; version <= versionCount; version++) {
      await writeFile(
        path.join(root, 'src/orphan-file.ts'),
        `export const orphan = ${version};`,
        'utf8',
      );
      const refreshed = await service.analyze(root);
      if (isErr(refreshed)) throw refreshed.error;
    }
    await service.dispose();

    const performance = new AnalysisPerformanceTracker();
    const restoredContainer = createContainer({
      logger: createSilentLogger(),
      storagePath,
      performanceRecorder: performance,
    });
    const storage = restoredContainer.resolve<IStoragePort>(TOKENS.StoragePort);
    const load = vi.spyOn(storage, 'load');
    const restoredService = restoredContainer.resolve<IProjectDNAService>(TOKENS.ProjectDNAService);
    const restored = await restoredService.restore(root);
    if (isErr(restored)) throw restored.error;
    expect(restored.value?.version).toBe(versionCount);
    const history = await restoredService.getHistory();
    if (isErr(history)) throw history.error;
    expect(history.value.map((snapshot) => snapshot.version).sort((a, b) => a - b)).toEqual(
      Array.from({ length: versionCount }, (_, index) => index + 1),
    );
    const loadCounts = load.mock.calls.reduce<Record<string, number>>((counts, [namespace]) => {
      counts[namespace] = (counts[namespace] ?? 0) + 1;
      return counts;
    }, {});
    expect(loadCounts).toEqual({
      'project-dna:aggregate': 1,
      'project-dna:entities': 1,
      'project-dna:domains': 1,
      'project-dna:capabilities': 1,
      'project-dna:knowledge': 1,
      'project-dna:risks': 1,
      'project-dna:dependency-graph': 1,
      'project-dna:dna-graph': 1,
      'project-dna:snapshots': 1,
      'project-dna:version-manifest': 1,
    });
    const recovery = performance
      .createReport()
      .measurements.find(
        (measurement) => measurement.stage === AnalysisPerformanceStages.StartupRecovery,
      );
    expect(recovery?.durationMs).toBeLessThan(5_000);
    await restoredService.dispose();
  }, 90_000);
});

interface PersistedFixture {
  readonly root: string;
  readonly storagePath: string;
  readonly repositoryId: string;
  readonly versionKey: string;
}

async function persistedFixture(): Promise<PersistedFixture> {
  const root = await fixtureRepository();
  const storageDirectory = await mkdtemp(path.join(tmpdir(), 'project-dna-persisted-'));
  roots.push(storageDirectory);
  const storagePath = path.join(storageDirectory, 'project-dna.sqlite');
  const container = createContainer({ logger: createSilentLogger(), storagePath });
  const service = container.resolve<IProjectDNAService>(TOKENS.ProjectDNAService);
  const analyzed = await service.analyze(root);
  if (isErr(analyzed)) throw analyzed.error;
  await service.dispose();
  return {
    root,
    storagePath,
    repositoryId: analyzed.value.id,
    versionKey: `${analyzed.value.id}:v00000001`,
  };
}

async function persistedHistory(versionCount: number): Promise<PersistedFixture> {
  const root = await fixtureRepository();
  const storageDirectory = await mkdtemp(path.join(tmpdir(), 'project-dna-history-fixture-'));
  roots.push(storageDirectory);
  const storagePath = path.join(storageDirectory, 'project-dna.sqlite');
  const container = createContainer({ logger: createSilentLogger(), storagePath });
  const service = container.resolve<IProjectDNAService>(TOKENS.ProjectDNAService);
  const first = await service.analyze(root);
  if (isErr(first)) throw first.error;
  for (let version = 2; version <= versionCount; version++) {
    await writeFile(
      path.join(root, 'src/orphan-file.ts'),
      `export const orphan = ${version};`,
      'utf8',
    );
    const analyzed = await service.analyze(root);
    if (isErr(analyzed)) throw analyzed.error;
  }
  await service.dispose();
  return {
    root,
    storagePath,
    repositoryId: first.value.id,
    versionKey: `${first.value.id}:v${versionCount.toString().padStart(8, '0')}`,
  };
}

type CorruptPersistedRecord = (storagePath: string, versionKey: string) => void;

const corruptDependencyGraph: CorruptPersistedRecord = (storagePath, versionKey) => {
  mutateStoredJson(storagePath, 'project-dna:dependency-graph', versionKey, (value) => {
    const graph = asRecord(value);
    const edges = asArray(graph['edges']);
    graph['edges'] = edges.slice(1);
    return graph;
  });
};

const corruptDnaGraph: CorruptPersistedRecord = (storagePath, versionKey) => {
  mutateStoredJson(storagePath, 'project-dna:dna-graph', versionKey, (value) => {
    const graph = asRecord(value);
    const edges = asArray(graph['edges']);
    graph['edges'] = edges.slice(1);
    return graph;
  });
};

const corruptDnaGraphNodeAttributes: CorruptPersistedRecord = (storagePath, versionKey) => {
  mutateStoredJson(storagePath, 'project-dna:dna-graph', versionKey, (value) => {
    const graph = asRecord(value);
    const nodes = asArray(graph['nodes']).map(asRecord);
    const attributes = asRecord(nodes[0]!['attributes']);
    attributes['weight'] = Number(attributes['weight']) === 0.25 ? 0.5 : 0.25;
    return graph;
  });
};

const corruptDnaGraphEdgeAttributes: CorruptPersistedRecord = (storagePath, versionKey) => {
  mutateStoredJson(storagePath, 'project-dna:dna-graph', versionKey, (value) => {
    const graph = asRecord(value);
    const edges = asArray(graph['edges']).map(asRecord);
    const attributes = asRecord(edges[0]!['attributes']);
    attributes['confidence'] = Number(attributes['confidence']) === 0.25 ? 0.5 : 0.25;
    return graph;
  });
};

const corruptCapabilityReference: CorruptPersistedRecord = (storagePath, versionKey) => {
  mutateStoredJson(storagePath, 'project-dna:capabilities', versionKey, (value) => {
    const capabilities = asArray(value).map(asRecord);
    capabilities[0]!['implementedBy'] = ['file:missing.ts'];
    return capabilities;
  });
};

const corruptDomainReference: CorruptPersistedRecord = (storagePath, versionKey) => {
  mutateStoredJson(storagePath, 'project-dna:domains', versionKey, (value) => {
    const domains = asArray(value).map(asRecord);
    domains[0]!['entityIds'] = ['file:missing.ts'];
    domains[0]!['fileCount'] = 1;
    return domains;
  });
};

const corruptDomainDependencyReference: CorruptPersistedRecord = (storagePath, versionKey) => {
  mutateStoredJson(storagePath, 'project-dna:domains', versionKey, (value) => {
    const domains = asArray(value).map(asRecord);
    domains[0]!['dependsOn'] = ['domain:missing'];
    return domains;
  });
};

const corruptKnowledgeReference: CorruptPersistedRecord = (storagePath, versionKey) => {
  mutateStoredJson(storagePath, 'project-dna:knowledge', versionKey, (value) => {
    const knowledge = asArray(value).map(asRecord);
    knowledge[0]!['relationships'] = [{ targetId: 'knowledge:missing', type: 'related-to' }];
    return knowledge;
  });
};

const corruptDuplicateKnowledgeId: CorruptPersistedRecord = (storagePath, versionKey) => {
  mutateStoredJson(storagePath, 'project-dna:knowledge', versionKey, (value) => {
    const knowledge = asArray(value).map(asRecord);
    if (knowledge.length < 2) throw new Error('Expected at least two knowledge nodes');
    knowledge[1]!['id'] = knowledge[0]!['id'];
    return knowledge;
  });
};

const corruptAggregateSemantics: CorruptPersistedRecord = (storagePath, versionKey) => {
  mutateStoredJson(storagePath, 'project-dna:aggregate', versionKey, (value) => {
    const aggregate = asRecord(value);
    aggregate['riskCount'] = Number(aggregate['riskCount']) + 1;
    return aggregate;
  });
};

const corruptComplexityWithMatchingSnapshot: CorruptPersistedRecord = (storagePath, versionKey) => {
  mutateAggregateAndSnapshot(storagePath, versionKey, (aggregate) => {
    aggregate.complexity.averageComplexity += 1;
    aggregate.complexity.averageAfferentCoupling += 1;
  });
};

const corruptHealthWithMatchingSnapshot: CorruptPersistedRecord = (storagePath, versionKey) => {
  mutateAggregateAndSnapshot(storagePath, versionKey, (aggregate) => {
    aggregate.health.dimensions.architectureHealth =
      aggregate.health.dimensions.architectureHealth === 100
        ? 99
        : aggregate.health.dimensions.architectureHealth + 1;
  });
};

const corruptRiskWithMatchingSnapshot: CorruptPersistedRecord = (storagePath, versionKey) => {
  mutateAggregateAndSnapshot(storagePath, versionKey, (aggregate) => {
    aggregate.risks.overallRiskScore =
      aggregate.risks.overallRiskScore === 100 ? 99 : aggregate.risks.overallRiskScore + 1;
    aggregate.health.dimensions.riskHealth = 100 - aggregate.risks.overallRiskScore;
    const dimensions = aggregate.health.dimensions;
    aggregate.health.overallScore = Math.round(
      dimensions.architectureHealth * 0.25 +
        dimensions.dependencyHealth * 0.2 +
        dimensions.complexityHealth * 0.25 +
        dimensions.knowledgeHealth * 0.15 +
        dimensions.riskHealth * 0.15,
    );
  });
};

const corruptSnapshotHash: CorruptPersistedRecord = (storagePath, versionKey) => {
  mutateStoredJson(storagePath, 'project-dna:snapshots', versionKey, (value) => {
    const snapshot = asRecord(value);
    snapshot['projectDnaHash'] = '0000000000000000';
    return snapshot;
  });
};

const corruptSnapshotMetrics: CorruptPersistedRecord = (storagePath, versionKey) => {
  mutateStoredJson(storagePath, 'project-dna:snapshots', versionKey, (value) => {
    const snapshot = asRecord(value);
    const metrics = asRecord(snapshot['metrics']);
    metrics['entities.total'] = Number(metrics['entities.total']) + 1;
    return snapshot;
  });
};

function mutateStoredJson(
  storagePath: string,
  namespace: string,
  key: string,
  mutate: (value: unknown) => unknown,
): void {
  const database = new Database(storagePath);
  const row = database
    .prepare('SELECT value FROM dna_store WHERE namespace = ? AND key = ?')
    .get(namespace, key) as { value: string } | undefined;
  if (!row) throw new Error(`Missing persisted test record ${namespace}/${key}`);
  database
    .prepare('UPDATE dna_store SET value = ? WHERE namespace = ? AND key = ?')
    .run(JSON.stringify(mutate(JSON.parse(row.value) as unknown)), namespace, key);
  database.close();
}

function mutateAggregateAndSnapshot(
  storagePath: string,
  versionKey: string,
  mutate: (aggregate: ProjectDNA) => void,
): void {
  const database = new Database(storagePath);
  const aggregateRow = database
    .prepare('SELECT value FROM dna_store WHERE namespace = ? AND key = ?')
    .get('project-dna:aggregate', versionKey) as { value: string } | undefined;
  const snapshotRow = database
    .prepare('SELECT value FROM dna_store WHERE namespace = ? AND key = ?')
    .get('project-dna:snapshots', versionKey) as { value: string } | undefined;
  if (!aggregateRow || !snapshotRow) throw new Error(`Missing persisted version ${versionKey}`);
  const aggregate = ProjectDNASchema.parse(JSON.parse(aggregateRow.value) as unknown);
  mutate(aggregate);
  const snapshot = asRecord(JSON.parse(snapshotRow.value) as unknown);
  snapshot['projectDnaHash'] = createProjectDnaSnapshotHash(aggregate);
  snapshot['metrics'] = createProjectDnaSnapshotMetrics(aggregate);
  const update = database.prepare('UPDATE dna_store SET value = ? WHERE namespace = ? AND key = ?');
  update.run(JSON.stringify(aggregate), 'project-dna:aggregate', versionKey);
  update.run(JSON.stringify(snapshot), 'project-dna:snapshots', versionKey);
  database.close();
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Expected persisted object');
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('Expected persisted array');
  return value;
}

function normalizeRoot(rootPath: string): string {
  const normalized = path.resolve(rootPath).replaceAll('\\', '/').replace(/\/+$/u, '');
  return /^[A-Z]:/u.test(normalized) ? normalized.toLowerCase() : normalized;
}

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

async function versionRows(storagePath: string, versionKey: string): Promise<string[]> {
  const database = new Database(storagePath, { readonly: true });
  const rows = database
    .prepare(
      `SELECT namespace
       FROM dna_store
       WHERE key = ? AND namespace LIKE 'project-dna:%'
       ORDER BY namespace ASC`,
    )
    .all(versionKey) as Array<{ namespace: string }>;
  database.close();
  return rows.map((row) => row.namespace);
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
