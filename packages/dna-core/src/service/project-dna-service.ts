import {
  DEFAULT_IGNORE_PATTERNS,
  DNAEventNames,
  Err,
  FILE_SIZE_LIMIT_BYTES,
  Ok,
  isErr,
  type RepositoryFilesChangedPayload,
  type RepositoryWatcherInvalidatedPayload,
  type DNAEventMap,
  type EventBus,
  type Logger,
  type Result,
} from '@project-dna/shared';
import path from 'node:path';
import type { AnalysisResult, DNAOrchestrator } from '../orchestrator/dna-orchestrator.js';
import {
  PipelineStage,
  calculateOverallProgress,
  type PipelineProgress,
} from '../orchestrator/pipeline.js';
import type { IDNAEngine, SynthesisOutput } from '../interfaces/dna-engine.interface.js';
import type { IEvolutionEngine } from '../interfaces/evolution-engine.interface.js';
import type { ISoftwareIntelligenceEngine } from '../interfaces/intelligence-engine.interface.js';
import type { IStoragePort } from '../interfaces/storage.interface.js';
import type {
  EntityFilter,
  IProjectDNAService,
} from '../interfaces/project-dna-service.interface.js';
import { ProjectDNASchema, type AnalysisConfig, type ProjectDNA } from '../models/project-dna.js';
import type { ArchitectureDNA } from '../models/architecture-dna.js';
import { BusinessDomainSchema, type BusinessDomain } from '../models/business-domain.js';
import { CapabilitySchema, type Capability } from '../models/capability.js';
import type { CriticalComponent } from '../models/critical-component.js';
import type { DNADiff } from '../models/dna-diff.js';
import { DNAGraph } from '../models/dna-graph.js';
import { DNAObjectSchema, type DNAObject } from '../models/dna-object.js';
import { EvolutionSnapshotSchema, type EvolutionSnapshot } from '../models/evolution-snapshot.js';
import { KnowledgeNodeSchema, type KnowledgeNode } from '../models/knowledge-node.js';
import { RepositoryGraph } from '../models/repository-graph.js';
import type { RepositoryHealth } from '../models/repository-health.js';
import type { RepositoryProfile } from '../models/repository-profile.js';
import type { RepositoryStory } from '../models/repository-story.js';
import type { RiskAssessment } from '../models/risk-assessment.js';

export interface ProjectDNAServiceDependencies {
  readonly orchestrator: DNAOrchestrator;
  readonly dnaEngine: IDNAEngine;
  readonly intelligenceEngine: ISoftwareIntelligenceEngine;
  readonly evolutionEngine: IEvolutionEngine;
  readonly eventBus: EventBus<DNAEventMap>;
  readonly logger: Logger;
  readonly storage?: IStoragePort;
  readonly analysisConfig?: Partial<AnalysisConfig>;
}

interface LoadedCollections {
  entities: DNAObject[];
  domains: BusinessDomain[];
  capabilities: Capability[];
  knowledge: KnowledgeNode[];
  dependencyGraph: RepositoryGraph;
  dnaGraph: DNAGraph;
}

const DEFAULT_ANALYSIS_CONFIG: AnalysisConfig = {
  maxFileSize: FILE_SIZE_LIMIT_BYTES,
  ignorePatterns: [...DEFAULT_IGNORE_PATTERNS],
  languages: [],
  complexityThreshold: 20,
  criticalityWeights: {
    centrality: 0.3,
    fanIn: 0.25,
    fanOut: 0.15,
    complexity: 0.2,
    size: 0.1,
  },
};

const STORAGE_NAMESPACES = {
  rootIndex: 'project-dna:root-index',
  latest: 'project-dna:latest',
  aggregate: 'project-dna:aggregate',
  entities: 'project-dna:entities',
  domains: 'project-dna:domains',
  capabilities: 'project-dna:capabilities',
  knowledge: 'project-dna:knowledge',
  dependencyGraph: 'project-dna:dependency-graph',
  dnaGraph: 'project-dna:dna-graph',
  snapshots: 'project-dna:snapshots',
} as const;

interface LatestAnalysisRecord {
  readonly version: number;
}

interface IncrementalBaseline {
  readonly analysis: AnalysisResult;
  readonly synthesis: SynthesisOutput;
}

class SupersededAnalysisError extends Error {
  constructor() {
    super('Analysis superseded by newer repository changes');
    this.name = 'SupersededAnalysisError';
  }
}

const CHANGE_DEBOUNCE_MS = 250;
const CHANGE_MAX_LATENCY_MS = 2_000;
const MAX_PENDING_PATHS = 10_000;

export class ProjectDNAService implements IProjectDNAService {
  private current: ProjectDNA | null = null;
  private collections: LoadedCollections | null = null;
  private rootPath: string | null = null;
  private readonly readyListeners = new Set<(dna: ProjectDNA) => void>();
  private readonly analysisConfig: AnalysisConfig;
  private analysisOperation: Promise<Result<ProjectDNA>> | null = null;
  private activeAnalysisRoot: string | null = null;
  private incrementalBaseline: IncrementalBaseline | null = null;
  private readonly pendingChanges = new Map<string, { path: string; generation: number }>();
  private pendingOverflow = false;
  private changeGeneration = 0;
  private watcherEpoch = 0;
  private watcherSequence = 0;
  private changeTimer: ReturnType<typeof setTimeout> | null = null;
  private changeBatchStartedAt: number | null = null;
  private disposed = false;
  private readonly unsubscribeRepositoryChanges: () => void;
  private readonly unsubscribeWatcherInvalidation: () => void;

  constructor(private readonly dependencies: ProjectDNAServiceDependencies) {
    this.analysisConfig = mergeAnalysisConfig(dependencies.analysisConfig);
    this.unsubscribeRepositoryChanges = dependencies.eventBus.on(
      DNAEventNames.RepositoryFilesChanged,
      (payload) => this.handleRepositoryFilesChanged(payload),
    );
    this.unsubscribeWatcherInvalidation = dependencies.eventBus.on(
      DNAEventNames.RepositoryWatcherInvalidated,
      (payload) => this.handleWatcherInvalidated(payload),
    );
  }

  private handleRepositoryFilesChanged(payload: RepositoryFilesChangedPayload): void {
    if (this.disposed) return;
    const normalizedRoot = normalizeRootPath(payload.rootPath);
    if (this.rootPath && normalizeRootPath(this.rootPath) !== normalizedRoot) return;
    if (payload.watcherEpoch < this.watcherEpoch) return;
    if (payload.watcherEpoch === this.watcherEpoch && payload.sequence <= this.watcherSequence) {
      return;
    }
    if (this.watcherEpoch === 0) {
      this.watcherEpoch = payload.watcherEpoch;
      this.watcherSequence = 0;
    } else if (payload.watcherEpoch > this.watcherEpoch) {
      this.pendingOverflow = true;
      this.pendingChanges.clear();
      this.watcherEpoch = payload.watcherEpoch;
      this.watcherSequence = 0;
    }
    if (payload.changes.length === 0) return;
    const acceptedPaths: string[] = [];
    for (const change of payload.changes) {
      const absolutePath = path.resolve(normalizedRoot, change.path);
      if (!isPathWithinRoot(normalizedRoot, absolutePath)) continue;
      acceptedPaths.push(absolutePath);
    }
    if (acceptedPaths.length === 0) return;
    this.watcherEpoch = payload.watcherEpoch;
    this.watcherSequence = payload.sequence;
    this.changeGeneration++;
    for (const absolutePath of acceptedPaths) {
      this.pendingChanges.set(normalizePathKey(absolutePath), {
        path: absolutePath,
        generation: this.changeGeneration,
      });
    }
    if (this.pendingChanges.size > MAX_PENDING_PATHS) this.pendingOverflow = true;
    if (!this.rootPath) this.rootPath = normalizedRoot;
    this.scheduleAutomaticRefresh();
  }

  private handleWatcherInvalidated(payload: RepositoryWatcherInvalidatedPayload): void {
    if (this.disposed) return;
    const normalizedRoot = normalizeRootPath(payload.rootPath);
    if (
      payload.watcherEpoch < this.watcherEpoch ||
      (this.watcherEpoch !== 0 && payload.watcherEpoch === this.watcherEpoch)
    ) {
      return;
    }
    if (payload.reason === 'workspace-change') {
      if (this.rootPath && normalizeRootPath(this.rootPath) !== normalizedRoot) this.clearCurrent();
      this.rootPath = normalizedRoot;
    } else if (this.rootPath && normalizeRootPath(this.rootPath) !== normalizedRoot) {
      return;
    }
    this.pendingOverflow = true;
    this.pendingChanges.clear();
    this.watcherEpoch = payload.watcherEpoch;
    this.watcherSequence = 0;
    this.changeGeneration++;
    this.scheduleAutomaticRefresh();
  }

  private scheduleAutomaticRefresh(): void {
    if (this.disposed || !this.rootPath || this.analysisOperation) return;
    if (this.changeBatchStartedAt === null) this.changeBatchStartedAt = Date.now();
    if (this.changeTimer) clearTimeout(this.changeTimer);
    const elapsed = Date.now() - this.changeBatchStartedAt;
    const delay = Math.max(0, Math.min(CHANGE_DEBOUNCE_MS, CHANGE_MAX_LATENCY_MS - elapsed));
    this.changeTimer = setTimeout(() => {
      this.changeTimer = null;
      this.changeBatchStartedAt = null;
      void this.runAutomaticRefresh();
    }, delay);
  }

  private async runAutomaticRefresh(): Promise<void> {
    if (this.disposed || this.analysisOperation || !this.rootPath) return;
    await this.refresh();
    if (this.pendingChanges.size > 0 || this.pendingOverflow) this.scheduleAutomaticRefresh();
  }

  async restore(rootPath: string): Promise<Result<ProjectDNA | null>> {
    const storage = this.dependencies.storage;
    if (!storage) return Ok(null);

    try {
      const rootKey = normalizeRootPath(rootPath);
      const indexed = await storage.exists(STORAGE_NAMESPACES.rootIndex, rootKey);
      if (isErr(indexed)) return indexed;
      if (!indexed.value) {
        const resetEvolution = await this.dependencies.evolutionEngine.restoreSnapshots([]);
        if (isErr(resetEvolution)) return resetEvolution;
        this.clearCurrent();
        return Ok(null);
      }

      const repositoryId = await storage.load<string>(STORAGE_NAMESPACES.rootIndex, rootKey);
      if (isErr(repositoryId)) return repositoryId;
      const hasLatest = await storage.exists(STORAGE_NAMESPACES.latest, repositoryId.value);
      if (isErr(hasLatest)) return hasLatest;
      if (!hasLatest.value) {
        const resetEvolution = await this.dependencies.evolutionEngine.restoreSnapshots([]);
        if (isErr(resetEvolution)) return resetEvolution;
        this.clearCurrent();
        return Ok(null);
      }
      const latest = await storage.load<LatestAnalysisRecord>(
        STORAGE_NAMESPACES.latest,
        repositoryId.value,
      );
      if (isErr(latest)) return latest;

      const versionKey = createVersionKey(repositoryId.value, latest.value.version);
      const [aggregate, entities, domains, capabilities, knowledge, dependencyGraph, dnaGraph] =
        await Promise.all([
          storage.load<unknown>(STORAGE_NAMESPACES.aggregate, versionKey),
          storage.load<DNAObject[]>(STORAGE_NAMESPACES.entities, versionKey),
          storage.load<BusinessDomain[]>(STORAGE_NAMESPACES.domains, versionKey),
          storage.load<Capability[]>(STORAGE_NAMESPACES.capabilities, versionKey),
          storage.load<KnowledgeNode[]>(STORAGE_NAMESPACES.knowledge, versionKey),
          storage.load<Record<string, unknown>>(STORAGE_NAMESPACES.dependencyGraph, versionKey),
          storage.load<Record<string, unknown>>(STORAGE_NAMESPACES.dnaGraph, versionKey),
        ]);
      if (isErr(aggregate)) return aggregate;
      if (isErr(entities)) return entities;
      if (isErr(domains)) return domains;
      if (isErr(capabilities)) return capabilities;
      if (isErr(knowledge)) return knowledge;
      if (isErr(dependencyGraph)) return dependencyGraph;
      if (isErr(dnaGraph)) return dnaGraph;

      const snapshots = await this.loadSnapshots(repositoryId.value);
      if (isErr(snapshots)) return snapshots;
      const restoredEvolution = await this.dependencies.evolutionEngine.restoreSnapshots(
        snapshots.value,
      );
      if (isErr(restoredEvolution)) return restoredEvolution;

      const dna = ProjectDNASchema.parse(aggregate.value);
      this.current = dna;
      this.rootPath = dna.rootPath;
      this.incrementalBaseline = null;
      this.collections = {
        entities: DNAObjectSchema.array().parse(entities.value),
        domains: BusinessDomainSchema.array().parse(domains.value),
        capabilities: CapabilitySchema.array().parse(capabilities.value),
        knowledge: KnowledgeNodeSchema.array().parse(knowledge.value),
        dependencyGraph: RepositoryGraph.fromJSON(dependencyGraph.value),
        dnaGraph: DNAGraph.fromJSON(dnaGraph.value),
      };
      this.dependencies.logger.info(`Restored Project DNA v${dna.version} for ${dna.rootPath}`);
      return Ok(dna);
    } catch (error) {
      const resolvedError = error instanceof Error ? error : new Error(String(error));
      return this.stageError('RestoringProjectDNA', resolvedError);
    }
  }

  async analyze(rootPath: string, signal?: AbortSignal): Promise<Result<ProjectDNA>> {
    return this.startAnalysis(rootPath, signal, true);
  }

  private async startAnalysis(
    rootPath: string,
    signal: AbortSignal | undefined,
    forceFull: boolean,
  ): Promise<Result<ProjectDNA>> {
    const normalizedRoot = normalizeRootPath(rootPath);
    if (this.analysisOperation) {
      return this.activeAnalysisRoot === normalizedRoot
        ? this.analysisOperation
        : Err(
            new Error(
              `Analysis already in progress for ${this.activeAnalysisRoot ?? 'another repository'}`,
            ),
          );
    }
    this.activeAnalysisRoot = normalizedRoot;
    const operation = Promise.resolve()
      .then(() => this.runAnalysis(normalizedRoot, forceFull, signal))
      .then((result) => {
        if (isErr(result) && !(result.error instanceof SupersededAnalysisError)) {
          this.emitProgress(PipelineStage.Failed, result.error.message, 0);
        }
        return result;
      })
      .finally(() => {
        this.analysisOperation = null;
        this.activeAnalysisRoot = null;
        if (this.pendingChanges.size > 0 || this.pendingOverflow) this.scheduleAutomaticRefresh();
      });
    this.analysisOperation = operation;
    this.emitProgress(PipelineStage.Scanning, 'Preparing repository analysis...', 0);
    return operation;
  }

  private async runAnalysis(
    rootPath: string,
    forceFull: boolean,
    signal?: AbortSignal,
  ): Promise<Result<ProjectDNA>> {
    const startTime = Date.now();
    const operationGeneration = this.changeGeneration;
    const changedPaths = [...this.pendingChanges.values()]
      .filter((entry) => entry.generation <= operationGeneration)
      .map((entry) => entry.path)
      .sort();
    const previousBaseline = !forceFull && !this.pendingOverflow ? this.incrementalBaseline : null;
    let previousCommitted: ProjectDNA | null = null;
    try {
      if (signal?.aborted) return Err(new Error('Project DNA analysis cancelled'));
      if (
        this.dependencies.storage &&
        (!this.rootPath || normalizeRootPath(this.rootPath) !== normalizeRootPath(rootPath))
      ) {
        const restored = await this.restore(rootPath);
        if (isErr(restored)) return restored;
      }
      previousCommitted = this.current;
      const analysis = previousBaseline
        ? await this.dependencies.orchestrator.analyzeRepositoryIncremental(
            {
              rootPath,
              previous: previousBaseline.analysis,
              changedPaths,
            },
            signal,
          )
        : await this.dependencies.orchestrator.analyzeRepository(rootPath, signal);
      if (isErr(analysis)) return analysis;

      this.emitProgress(PipelineStage.SynthesizingDNA, 'Synthesizing Project DNA...', 0);
      this.dependencies.eventBus.emit(DNAEventNames.DNASynthesisStarted, {
        entityCount: analysis.value.files.length,
        timestamp: Date.now(),
      });
      const synthesisInput = {
        repository: analysis.value.repository,
        files: analysis.value.files,
        dependencyGraph: analysis.value.graph,
        architecture: analysis.value.architecture,
        knowledgeNodes: analysis.value.knowledge.nodes,
        risks: analysis.value.knowledge.risks,
      };
      const synthesis =
        previousBaseline && this.dependencies.dnaEngine.synthesizeIncremental
          ? await this.dependencies.dnaEngine.synthesizeIncremental(
              {
                input: synthesisInput,
                previous: previousBaseline.synthesis,
                dirtyEntityIds: (analysis.value.dirtyPaths ?? []).map(
                  (filePath) => `file:${filePath}`,
                ),
              },
              signal,
            )
          : await this.dependencies.dnaEngine.synthesize(synthesisInput, signal);
      if (isErr(synthesis)) return this.stageError('SynthesizingDNA', synthesis.error);

      this.dependencies.eventBus.emit(DNAEventNames.DNAGraphBuilt, {
        nodeCount: synthesis.value.dnaGraph.nodeCount,
        edgeCount: synthesis.value.dnaGraph.edgeCount,
        durationMs: Date.now() - startTime,
      });
      this.dependencies.eventBus.emit(DNAEventNames.DNASynthesisComplete, {
        entityCount: synthesis.value.entities.length,
        domainCount: synthesis.value.domains.length,
        capabilityCount: synthesis.value.capabilities.length,
        durationMs: Date.now() - startTime,
      });

      this.emitProgress(
        PipelineStage.ComputingIntelligence,
        'Computing software intelligence...',
        0,
      );
      this.dependencies.eventBus.emit(DNAEventNames.IntelligenceStarted, { timestamp: Date.now() });
      const intelligence = await this.dependencies.intelligenceEngine.computeIntelligence(
        {
          entities: synthesis.value.entities,
          dnaGraph: synthesis.value.dnaGraph,
          profile: synthesis.value.profile,
          architecture: analysis.value.architecture,
          knowledgeNodes: analysis.value.knowledge.nodes,
          risks: analysis.value.knowledge.risks,
        },
        signal,
      );
      if (isErr(intelligence)) return this.stageError('ComputingIntelligence', intelligence.error);

      this.emitIntelligenceEvents(intelligence.value, startTime);

      const candidateBaseline: IncrementalBaseline = {
        analysis: analysis.value,
        synthesis: synthesis.value,
      };
      if (this.changeGeneration !== operationGeneration) {
        return Err(new SupersededAnalysisError());
      }
      if (
        previousBaseline &&
        this.current &&
        equivalentBaseline(previousBaseline, candidateBaseline)
      ) {
        this.incrementalBaseline = candidateBaseline;
        this.acknowledgeChanges(operationGeneration);
        this.emitProgress(PipelineStage.Complete, 'Project DNA is already current.', 1);
        return Ok(this.current);
      }
      const version = (this.current?.version ?? 0) + 1;
      const versionKey = createVersionKey(analysis.value.repository.id, version);
      const dna = ProjectDNASchema.parse({
        id: analysis.value.repository.id,
        version,
        analyzedAt: Date.now(),
        rootPath: analysis.value.repository.rootPath,
        profile: synthesis.value.profile,
        architecture: analysis.value.architecture,
        moduleCount: countModules(analysis.value.graph),
        entityCount: synthesis.value.entities.length,
        health: intelligence.value.health,
        complexity: intelligence.value.complexity,
        risks: intelligence.value.risks,
        criticalComponents: intelligence.value.criticalComponents,
        domainCount: synthesis.value.domains.length,
        capabilityCount: synthesis.value.capabilities.length,
        knowledgeNodeCount: analysis.value.knowledge.nodes.length,
        riskCount: analysis.value.knowledge.risks.length,
        dependencyGraphRef: this.dependencies.storage
          ? `${STORAGE_NAMESPACES.dependencyGraph}:${versionKey}`
          : `memory:dependency-graph:${analysis.value.repository.id}:v${version}`,
        dnaGraphRef: this.dependencies.storage
          ? `${STORAGE_NAMESPACES.dnaGraph}:${versionKey}`
          : `memory:dna-graph:${analysis.value.repository.id}:v${version}`,
        story: intelligence.value.story,
        analysisCoverage: analysis.value.coverage ?? {
          scanned: analysis.value.repository.totalFiles,
          parsed: analysis.value.files.length,
          skipped: Math.max(0, analysis.value.repository.totalFiles - analysis.value.files.length),
          failed: 0,
        },
        analysisConfig: this.analysisConfig,
        durationMs: Date.now() - startTime,
      });

      if (signal?.aborted) return Err(new Error('Project DNA analysis cancelled'));
      if (this.changeGeneration !== operationGeneration) {
        return Err(new SupersededAnalysisError());
      }
      this.emitProgress(PipelineStage.ComputingEvolution, 'Creating evolution snapshot...', 0);
      const previousHistory = await this.dependencies.evolutionEngine.getHistory();
      if (isErr(previousHistory))
        return this.stageError('ComputingEvolution', previousHistory.error);
      const snapshot = await this.dependencies.evolutionEngine.createSnapshot(dna, signal);
      if (isErr(snapshot)) return this.stageError('ComputingEvolution', snapshot.error);
      if (this.changeGeneration !== operationGeneration || this.disposed) {
        await this.dependencies.evolutionEngine.restoreSnapshots(previousHistory.value);
        return Err(new SupersededAnalysisError());
      }

      const collections: LoadedCollections = {
        entities: synthesis.value.entities,
        domains: synthesis.value.domains,
        capabilities: synthesis.value.capabilities,
        knowledge: analysis.value.knowledge.nodes,
        dependencyGraph: analysis.value.graph,
        dnaGraph: synthesis.value.dnaGraph,
      };
      const persisted = await this.persistAnalysis(
        dna,
        collections,
        snapshot.value,
        operationGeneration,
        previousCommitted?.version ?? null,
      );
      if (isErr(persisted)) {
        await this.dependencies.evolutionEngine.restoreSnapshots(previousHistory.value);
        if (persisted.error instanceof SupersededAnalysisError) return persisted;
        return this.stageError('PersistingProjectDNA', persisted.error);
      }

      if (this.changeGeneration !== operationGeneration || this.disposed) {
        await this.dependencies.evolutionEngine.restoreSnapshots(previousHistory.value);
        await this.removePersistedCandidate(dna, previousCommitted?.version ?? null);
        return Err(new SupersededAnalysisError());
      }

      this.current = dna;
      this.rootPath = dna.rootPath;
      this.collections = collections;
      this.incrementalBaseline = candidateBaseline;
      this.acknowledgeChanges(operationGeneration);
      this.dependencies.eventBus.emit(DNAEventNames.EvolutionSnapshotCreated, {
        snapshotId: snapshot.value.id,
        version: snapshot.value.version,
        isFullSnapshot: snapshot.value.isFullSnapshot,
      });
      this.dependencies.eventBus.emit(DNAEventNames.ProjectDNAReady, {
        version: dna.version,
        entityCount: dna.entityCount,
        healthScore: dna.health.overallScore,
        durationMs: dna.durationMs,
      });
      this.emitProgress(PipelineStage.Complete, 'Project DNA ready.', 1);
      for (const listener of this.readyListeners) {
        try {
          listener(dna);
        } catch (error) {
          this.dependencies.logger.error(`Project DNA ready listener failed: ${String(error)}`);
        }
      }
      return Ok(dna);
    } catch (error) {
      const resolvedError = error instanceof Error ? error : new Error(String(error));
      return this.stageError('ProjectDNAService', resolvedError);
    }
  }

  async refresh(signal?: AbortSignal): Promise<Result<ProjectDNA>> {
    if (this.analysisOperation) return this.analysisOperation;
    if (!this.rootPath) return Err(new Error('No repository has been analyzed'));
    return this.startAnalysis(this.rootPath, signal, false);
  }

  getCurrent(): Result<ProjectDNA | null> {
    return Ok(this.current);
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.changeGeneration++;
    if (this.changeTimer) clearTimeout(this.changeTimer);
    this.changeTimer = null;
    this.unsubscribeRepositoryChanges();
    this.unsubscribeWatcherInvalidation();
    this.pendingChanges.clear();
    this.clearCurrent();
    this.readyListeners.clear();
    await this.dependencies.storage?.close();
  }

  getArchitecture(): ArchitectureDNA {
    return this.requireCurrent().architecture;
  }
  getHealth(): RepositoryHealth {
    return this.requireCurrent().health;
  }
  getIdentity(): RepositoryProfile {
    return this.requireCurrent().profile;
  }
  getStory(): RepositoryStory {
    return this.requireCurrent().story;
  }
  getRisks(): RiskAssessment {
    return this.requireCurrent().risks;
  }
  getCriticalComponents(): CriticalComponent[] {
    return [...this.requireCurrent().criticalComponents];
  }

  async getDomains(): Promise<Result<BusinessDomain[]>> {
    if (!this.collections) return Err(new Error('No Project DNA collections are currently loaded'));
    return Ok([...this.collections.domains]);
  }
  async getCapabilities(): Promise<Result<Capability[]>> {
    if (!this.collections) return Err(new Error('No Project DNA collections are currently loaded'));
    return Ok([...this.collections.capabilities]);
  }
  async getKnowledge(limit?: number): Promise<Result<KnowledgeNode[]>> {
    if (!this.collections) return Err(new Error('No Project DNA collections are currently loaded'));
    const nodes = this.collections.knowledge;
    return Ok(limit === undefined ? [...nodes] : nodes.slice(0, Math.max(0, limit)));
  }
  async getEntities(filter: EntityFilter = {}): Promise<Result<DNAObject[]>> {
    if (!this.collections) return Err(new Error('No Project DNA collections are currently loaded'));
    let entities = this.collections.entities.filter(
      (entity) =>
        (filter.domain === undefined ||
          entity.businessDomain === filter.domain ||
          entity.belongsToDomain === filter.domain) &&
        (filter.layer === undefined || entity.belongsToLayer === filter.layer) &&
        (filter.criticality === undefined || entity.criticality === filter.criticality) &&
        (filter.kind === undefined || entity.kind === filter.kind),
    );
    const offset = Math.max(0, filter.offset ?? 0);
    entities = entities.slice(
      offset,
      filter.limit === undefined ? undefined : offset + Math.max(0, filter.limit),
    );
    return Ok(entities);
  }
  async getEntity(id: string): Promise<Result<DNAObject | null>> {
    if (!this.collections) return Err(new Error('No Project DNA collections are currently loaded'));
    return Ok(this.collections.entities.find((entity) => entity.id === id) ?? null);
  }
  async getDependencyGraph(): Promise<Result<RepositoryGraph>> {
    return this.collections
      ? Ok(this.collections.dependencyGraph)
      : Err(new Error('No Project DNA collections are currently loaded'));
  }
  async getDNAGraph(): Promise<Result<DNAGraph>> {
    return this.collections
      ? Ok(this.collections.dnaGraph)
      : Err(new Error('No Project DNA collections are currently loaded'));
  }

  getHistory(limit?: number): Promise<Result<EvolutionSnapshot[]>> {
    return this.dependencies.evolutionEngine.getHistory(limit);
  }
  getDiff(fromVersion: number, toVersion: number): Promise<Result<DNADiff>> {
    return this.dependencies.evolutionEngine.computeDiff(fromVersion, toVersion);
  }
  getLatestSnapshot(): Promise<Result<EvolutionSnapshot | null>> {
    return this.dependencies.evolutionEngine.getLatestSnapshot();
  }

  onProgress(listener: (progress: PipelineProgress) => void): () => void {
    return this.dependencies.eventBus.on(DNAEventNames.AnalysisProgress, (progress) => {
      listener({ ...progress, stage: progress.stage as PipelineStage });
    });
  }
  onReady(listener: (dna: ProjectDNA) => void): () => void {
    this.readyListeners.add(listener);
    return () => this.readyListeners.delete(listener);
  }

  private requireCurrent(): ProjectDNA {
    if (!this.current) throw new Error('No Project DNA is currently loaded');
    return this.current;
  }
  private clearCurrent(): void {
    this.current = null;
    this.collections = null;
    this.rootPath = null;
    this.incrementalBaseline = null;
  }

  private acknowledgeChanges(operationGeneration: number): void {
    for (const [key, entry] of this.pendingChanges) {
      if (entry.generation <= operationGeneration) this.pendingChanges.delete(key);
    }
    if (this.changeGeneration === operationGeneration) this.pendingOverflow = false;
  }
  private async persistAnalysis(
    dna: ProjectDNA,
    collections: LoadedCollections,
    snapshot: EvolutionSnapshot,
    operationGeneration: number,
    previousVersion: number | null,
  ): Promise<Result<void>> {
    const storage = this.dependencies.storage;
    if (!storage) return Ok(undefined);

    const versionKey = createVersionKey(dna.id, dna.version);
    const records: ReadonlyArray<readonly [string, string, unknown]> = [
      [STORAGE_NAMESPACES.aggregate, versionKey, dna],
      [STORAGE_NAMESPACES.entities, versionKey, collections.entities],
      [STORAGE_NAMESPACES.domains, versionKey, collections.domains],
      [STORAGE_NAMESPACES.capabilities, versionKey, collections.capabilities],
      [STORAGE_NAMESPACES.knowledge, versionKey, collections.knowledge],
      [STORAGE_NAMESPACES.dependencyGraph, versionKey, collections.dependencyGraph.toJSON()],
      [STORAGE_NAMESPACES.dnaGraph, versionKey, collections.dnaGraph.toJSON()],
      [STORAGE_NAMESPACES.snapshots, versionKey, snapshot],
      [STORAGE_NAMESPACES.rootIndex, normalizeRootPath(dna.rootPath), dna.id],
    ];

    for (const [namespace, key, value] of records) {
      if (this.changeGeneration !== operationGeneration || this.disposed) {
        await this.removePersistedCandidate(dna, previousVersion);
        return Err(new SupersededAnalysisError());
      }
      const saved = await storage.save(namespace, key, value);
      if (isErr(saved)) return saved;
    }

    if (this.changeGeneration !== operationGeneration || this.disposed) {
      await this.removePersistedCandidate(dna, previousVersion);
      return Err(new SupersededAnalysisError());
    }
    const savedLatest = await storage.save<LatestAnalysisRecord>(
      STORAGE_NAMESPACES.latest,
      dna.id,
      {
        version: dna.version,
      },
    );
    if (isErr(savedLatest)) return savedLatest;
    if (this.changeGeneration !== operationGeneration || this.disposed) {
      await this.removePersistedCandidate(dna, previousVersion);
      return Err(new SupersededAnalysisError());
    }
    return Ok(undefined);
  }

  private async removePersistedCandidate(
    dna: ProjectDNA,
    previousVersion: number | null,
  ): Promise<void> {
    const storage = this.dependencies.storage;
    if (!storage) return;
    const versionKey = createVersionKey(dna.id, dna.version);
    const versionNamespaces = [
      STORAGE_NAMESPACES.aggregate,
      STORAGE_NAMESPACES.entities,
      STORAGE_NAMESPACES.domains,
      STORAGE_NAMESPACES.capabilities,
      STORAGE_NAMESPACES.knowledge,
      STORAGE_NAMESPACES.dependencyGraph,
      STORAGE_NAMESPACES.dnaGraph,
      STORAGE_NAMESPACES.snapshots,
    ] as const;
    for (const namespace of versionNamespaces) {
      const deleted = await storage.delete(namespace, versionKey);
      if (isErr(deleted)) {
        this.dependencies.logger.warn(
          `Could not remove superseded analysis ${namespace}/${versionKey}: ${deleted.error.message}`,
        );
      }
    }
    if (previousVersion !== null) {
      const restoredLatest = await storage.save<LatestAnalysisRecord>(
        STORAGE_NAMESPACES.latest,
        dna.id,
        { version: previousVersion },
      );
      if (isErr(restoredLatest)) {
        this.dependencies.logger.warn(
          `Could not restore latest analysis pointer for ${dna.id}: ${restoredLatest.error.message}`,
        );
      }
    } else {
      const deletedLatest = await storage.delete(STORAGE_NAMESPACES.latest, dna.id);
      if (isErr(deletedLatest)) {
        this.dependencies.logger.warn(
          `Could not remove latest analysis pointer for ${dna.id}: ${deletedLatest.error.message}`,
        );
      }
    }
  }
  private async loadSnapshots(repositoryId: string): Promise<Result<EvolutionSnapshot[]>> {
    const storage = this.dependencies.storage;
    if (!storage) return Ok([]);
    const listed = await storage.list(STORAGE_NAMESPACES.snapshots);
    if (isErr(listed)) return listed;
    const prefix = `${repositoryId}:v`;
    const keys = listed.value.filter((key) => key.startsWith(prefix));
    const snapshots: EvolutionSnapshot[] = [];
    for (const key of keys) {
      const loaded = await storage.load<unknown>(STORAGE_NAMESPACES.snapshots, key);
      if (isErr(loaded)) return loaded;
      snapshots.push(EvolutionSnapshotSchema.parse(loaded.value));
    }
    return Ok(snapshots);
  }
  private emitProgress(stage: PipelineStage, message: string, stageProgress: number): void {
    this.dependencies.eventBus.emit(DNAEventNames.AnalysisProgress, {
      stage,
      message,
      percent: calculateOverallProgress(stage, stageProgress),
      startedAt: Date.now(),
    });
  }
  private emitIntelligenceEvents(
    intelligence: Awaited<
      ReturnType<ISoftwareIntelligenceEngine['computeIntelligence']>
    > extends Result<infer T>
      ? T
      : never,
    startTime: number,
  ): void {
    const durationMs = Date.now() - startTime;
    this.dependencies.eventBus.emit(DNAEventNames.HealthComputed, {
      overallScore: intelligence.health.overallScore,
      durationMs,
    });
    this.dependencies.eventBus.emit(DNAEventNames.CriticalityComputed, {
      criticalCount: intelligence.criticalComponents.filter(
        (item) => item.criticality === 'critical',
      ).length,
      highCount: intelligence.criticalComponents.filter((item) => item.criticality === 'high')
        .length,
      durationMs,
    });
    this.dependencies.eventBus.emit(DNAEventNames.RiskAssessmentComplete, {
      totalRisks: intelligence.risks.totalRisks,
      criticalRisks: intelligence.risks.bySeverity.critical,
      durationMs,
    });
    this.dependencies.eventBus.emit(DNAEventNames.StoryGenerated, {
      locale: intelligence.story.locale,
      durationMs,
    });
    this.dependencies.eventBus.emit(DNAEventNames.IntelligenceComplete, {
      healthScore: intelligence.health.overallScore,
      riskScore: intelligence.risks.overallRiskScore,
      durationMs,
    });
  }
  private stageError<T>(stage: string, error: unknown): Result<T> {
    const resolvedError = error instanceof Error ? error : new Error(String(error));
    this.dependencies.logger.error(`${stage} failed: ${resolvedError.message}`);
    this.dependencies.eventBus.emit(DNAEventNames.AnalysisError, { stage, error: resolvedError });
    return Err(resolvedError);
  }
}

function mergeAnalysisConfig(config?: Partial<AnalysisConfig>): AnalysisConfig {
  return {
    ...DEFAULT_ANALYSIS_CONFIG,
    ...config,
    ignorePatterns: config?.ignorePatterns ?? DEFAULT_ANALYSIS_CONFIG.ignorePatterns,
    languages: config?.languages ?? DEFAULT_ANALYSIS_CONFIG.languages,
    criticalityWeights: {
      ...DEFAULT_ANALYSIS_CONFIG.criticalityWeights,
      ...config?.criticalityWeights,
    },
  };
}

function countModules(graph: RepositoryGraph): number {
  const moduleNodes = graph.getNodesByKind('module').length;
  if (moduleNodes > 0) return moduleNodes;
  const modules = new Set<string>();
  graph.forEachNode((id, attributes) => {
    if (attributes.kind !== 'file') return;
    const path = (attributes.path ?? id).replaceAll('\\', '/');
    const segments = path.split('/');
    modules.add(segments.length > 1 ? segments.slice(0, -1).join('/') : '_root');
  });
  return modules.size;
}

function createVersionKey(repositoryId: string, version: number): string {
  return `${repositoryId}:v${version.toString().padStart(8, '0')}`;
}

function normalizeRootPath(rootPath: string): string {
  const normalized = path.resolve(rootPath).replaceAll('\\', '/').replace(/\/+$/u, '');
  return /^[A-Z]:/u.test(normalized) ? normalized.toLowerCase() : normalized;
}

function normalizePathKey(filePath: string): string {
  const normalized = path.resolve(filePath).replaceAll('\\', '/').replace(/\/+$/u, '');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isPathWithinRoot(rootPath: string, filePath: string): boolean {
  const root = normalizePathKey(rootPath);
  const candidate = normalizePathKey(filePath);
  return candidate === root || candidate.startsWith(`${root}/`);
}

function equivalentBaseline(left: IncrementalBaseline, right: IncrementalBaseline): boolean {
  return stableStringify(baselineValue(left)) === stableStringify(baselineValue(right));
}

function baselineValue(baseline: IncrementalBaseline): unknown {
  return {
    repository: baseline.analysis.repository,
    files: baseline.analysis.files,
    graph: graphComparisonValue(baseline.analysis.graph.toJSON()),
    architecture: baseline.analysis.architecture,
    knowledge: baseline.analysis.knowledge,
    coverage: baseline.analysis.coverage,
    failedPaths: baseline.analysis.failedPaths,
    synthesis: {
      entities: baseline.synthesis.entities,
      dnaGraph: graphComparisonValue(baseline.synthesis.dnaGraph.toJSON()),
      profile: baseline.synthesis.profile,
      domains: baseline.synthesis.domains,
      capabilities: baseline.synthesis.capabilities,
    },
  };
}

const VOLATILE_COMPARISON_KEYS = new Set([
  'createdAt',
  'updatedAt',
  'detectedAt',
  'analyzedAt',
  'lastAnalyzedAt',
  'durationMs',
]);

function stableStringify(value: unknown): string {
  return JSON.stringify(normalizeComparisonValue(value));
}

function graphComparisonValue(value: object): unknown {
  const graph = value as {
    readonly nodes?: ReadonlyArray<Record<string, unknown>>;
    readonly edges?: ReadonlyArray<Record<string, unknown>>;
    readonly [key: string]: unknown;
  };
  return {
    ...graph,
    nodes: graph.nodes
      ? [...graph.nodes].sort((left, right) =>
          String(left['key']).localeCompare(String(right['key'])),
        )
      : undefined,
    edges: graph.edges
      ? graph.edges
          .map(({ key: _generatedKey, ...edge }) => edge)
          .sort((left, right) => graphEdgeKey(left).localeCompare(graphEdgeKey(right)))
      : undefined,
  };
}

function graphEdgeKey(edge: Readonly<Record<string, unknown>>): string {
  return `${String(edge['source'])}\u0000${String(edge['target'])}\u0000${JSON.stringify(edge['attributes'] ?? {})}`;
}

function normalizeComparisonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeComparisonValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !VOLATILE_COMPARISON_KEYS.has(key))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, normalizeComparisonValue(nested)]),
  );
}
