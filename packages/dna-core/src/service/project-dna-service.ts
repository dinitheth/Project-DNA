import {
  DEFAULT_IGNORE_PATTERNS,
  DNAEventNames,
  Err,
  FILE_SIZE_LIMIT_BYTES,
  Ok,
  isErr,
  type DNAEventMap,
  type EventBus,
  type Logger,
  type Result,
} from '@project-dna/shared';
import path from 'node:path';
import type { DNAOrchestrator } from '../orchestrator/dna-orchestrator.js';
import {
  PipelineStage,
  calculateOverallProgress,
  type PipelineProgress,
} from '../orchestrator/pipeline.js';
import type { IDNAEngine } from '../interfaces/dna-engine.interface.js';
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

export class ProjectDNAService implements IProjectDNAService {
  private current: ProjectDNA | null = null;
  private collections: LoadedCollections | null = null;
  private rootPath: string | null = null;
  private readonly readyListeners = new Set<(dna: ProjectDNA) => void>();
  private readonly analysisConfig: AnalysisConfig;

  constructor(private readonly dependencies: ProjectDNAServiceDependencies) {
    this.analysisConfig = mergeAnalysisConfig(dependencies.analysisConfig);
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
    const startTime = Date.now();
    try {
      if (signal?.aborted) return Err(new Error('Project DNA analysis cancelled'));
      if (
        this.dependencies.storage &&
        (!this.rootPath || normalizeRootPath(this.rootPath) !== normalizeRootPath(rootPath))
      ) {
        const restored = await this.restore(rootPath);
        if (isErr(restored)) return restored;
      }
      const analysis = await this.dependencies.orchestrator.analyzeRepository(rootPath, signal);
      if (isErr(analysis)) return analysis;

      this.emitProgress(PipelineStage.SynthesizingDNA, 'Synthesizing Project DNA...', 0);
      this.dependencies.eventBus.emit(DNAEventNames.DNASynthesisStarted, {
        entityCount: analysis.value.files.length,
        timestamp: Date.now(),
      });
      const synthesis = await this.dependencies.dnaEngine.synthesize(
        {
          repository: analysis.value.repository,
          files: analysis.value.files,
          dependencyGraph: analysis.value.graph,
          architecture: analysis.value.architecture,
          knowledgeNodes: analysis.value.knowledge.nodes,
          risks: analysis.value.knowledge.risks,
        },
        signal,
      );
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
        analysisConfig: this.analysisConfig,
        durationMs: Date.now() - startTime,
      });

      if (signal?.aborted) return Err(new Error('Project DNA analysis cancelled'));
      this.emitProgress(PipelineStage.ComputingEvolution, 'Creating evolution snapshot...', 0);
      const previousHistory = await this.dependencies.evolutionEngine.getHistory();
      if (isErr(previousHistory)) return this.stageError('ComputingEvolution', previousHistory.error);
      const snapshot = await this.dependencies.evolutionEngine.createSnapshot(dna, signal);
      if (isErr(snapshot)) return this.stageError('ComputingEvolution', snapshot.error);

      const collections: LoadedCollections = {
        entities: synthesis.value.entities,
        domains: synthesis.value.domains,
        capabilities: synthesis.value.capabilities,
        knowledge: analysis.value.knowledge.nodes,
        dependencyGraph: analysis.value.graph,
        dnaGraph: synthesis.value.dnaGraph,
      };
      const persisted = await this.persistAnalysis(dna, collections, snapshot.value);
      if (isErr(persisted)) {
        await this.dependencies.evolutionEngine.restoreSnapshots(previousHistory.value);
        return this.stageError('PersistingProjectDNA', persisted.error);
      }

      this.current = dna;
      this.rootPath = dna.rootPath;
      this.collections = collections;
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
    if (!this.rootPath) return Err(new Error('No repository has been analyzed'));
    return this.analyze(this.rootPath, signal);
  }

  getCurrent(): Result<ProjectDNA | null> {
    return Ok(this.current);
  }

  async dispose(): Promise<void> {
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
  }
  private async persistAnalysis(
    dna: ProjectDNA,
    collections: LoadedCollections,
    snapshot: EvolutionSnapshot,
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
      const saved = await storage.save(namespace, key, value);
      if (isErr(saved)) return saved;
    }

    return storage.save<LatestAnalysisRecord>(STORAGE_NAMESPACES.latest, dna.id, {
      version: dna.version,
    });
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
