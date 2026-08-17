/** Coordinates full and incremental repository analysis through injected engine ports. */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DNAEventNames,
  Err,
  Ok,
  isErr,
  type DNAEventMap,
  type EventBus,
  type Logger,
  type Result,
} from '@project-dna/shared';
import { traverseDependencyGraph } from '../graph/dependency-traversal.js';
import type { IArchitectureEngine } from '../interfaces/architecture-engine.interface.js';
import type { FileInput, IAstEngine } from '../interfaces/ast-engine.interface.js';
import type { IDependencyEngine } from '../interfaces/dependency-engine.interface.js';
import type {
  IKnowledgeEngine,
  KnowledgeResult,
} from '../interfaces/knowledge-engine.interface.js';
import type {
  IRepositoryScanner,
  RepositoryManifestEntry,
  RepositoryScanResult,
} from '../interfaces/scanner.interface.js';
import type { ArchitectureDNA } from '../models/architecture-dna.js';
import type { FileDNA } from '../models/file-dna.js';
import type { AnalysisCoverage } from '../models/project-dna.js';
import type { RepositoryDNA } from '../models/repository-dna.js';
import type { RepositoryGraph } from '../models/repository-graph.js';
import {
  AnalysisPerformanceStages,
  measureAnalysisPerformance,
  measureAnalysisPerformanceSync,
  type AnalysisPerformanceRecorder,
} from '../performance/analysis-performance.js';
import { PipelineStage, calculateOverallProgress } from './pipeline.js';

/** Complete core-analysis result used by synthesis and incremental baselines. */
export interface AnalysisResult {
  repository: RepositoryDNA;
  files: FileDNA[];
  graph: RepositoryGraph;
  architecture: ArchitectureDNA;
  knowledge: KnowledgeResult;
  coverage?: AnalysisCoverage;
  durationMs: number;
  /** Scanner state is optional for compatibility with pre-M2 integrations. */
  scan?: RepositoryScanResult;
  /** Supported files that could not be read or parsed in this generation. */
  failedPaths?: string[];
  /** Canonical repository-relative paths requiring downstream entity refresh. */
  dirtyPaths?: string[];
}

export interface IncrementalAnalysisRequest {
  readonly rootPath: string;
  readonly previous: AnalysisResult;
  readonly changedPaths: readonly string[];
}

export interface OrchestratorDependencies {
  scanner: IRepositoryScanner;
  astEngine: IAstEngine;
  dependencyEngine: IDependencyEngine;
  architectureEngine: IArchitectureEngine;
  knowledgeEngine: IKnowledgeEngine;
  eventBus: EventBus<DNAEventMap>;
  logger: Logger;
  performanceRecorder?: AnalysisPerformanceRecorder;
}

interface ParseContext {
  readonly previous?: AnalysisResult;
  readonly changedPaths: readonly string[];
}

interface ParsedFiles {
  readonly files: FileDNA[];
  readonly failedPaths: string[];
  readonly coverage: AnalysisCoverage;
}

interface CoreStages {
  readonly graph: RepositoryGraph;
  readonly architecture: ArchitectureDNA;
  readonly knowledge: KnowledgeResult;
  readonly dirtyPaths: string[];
}

export class DNAOrchestrator {
  private readonly scanner: IRepositoryScanner;
  private readonly astEngine: IAstEngine;
  private readonly dependencyEngine: IDependencyEngine;
  private readonly architectureEngine: IArchitectureEngine;
  private readonly knowledgeEngine: IKnowledgeEngine;
  private readonly eventBus: EventBus<DNAEventMap>;
  private readonly logger: Logger;
  private readonly performanceRecorder?: AnalysisPerformanceRecorder;

  constructor(dependencies: OrchestratorDependencies) {
    this.scanner = dependencies.scanner;
    this.astEngine = dependencies.astEngine;
    this.dependencyEngine = dependencies.dependencyEngine;
    this.architectureEngine = dependencies.architectureEngine;
    this.knowledgeEngine = dependencies.knowledgeEngine;
    this.eventBus = dependencies.eventBus;
    this.logger = dependencies.logger;
    this.performanceRecorder = dependencies.performanceRecorder;
  }

  /** Run the complete analysis pipeline and establish a new incremental baseline. */
  async analyzeRepository(rootPath: string, signal?: AbortSignal): Promise<Result<AnalysisResult>> {
    return this.runAnalysis(rootPath, [], undefined, signal);
  }

  /** Reconcile filesystem changes against a committed complete analysis result. */
  async analyzeRepositoryIncremental(
    request: IncrementalAnalysisRequest,
    signal?: AbortSignal,
  ): Promise<Result<AnalysisResult>> {
    return this.runAnalysis(request.rootPath, request.changedPaths, request.previous, signal);
  }

  private async runAnalysis(
    rootPath: string,
    changedPaths: readonly string[],
    previous: AnalysisResult | undefined,
    signal?: AbortSignal,
  ): Promise<Result<AnalysisResult>> {
    const startTime = Date.now();
    this.logger.info(
      `${previous ? 'Incrementally analyzing' : 'Starting analysis of'} ${rootPath}`,
    );

    const cancelled = this.checkCancelled(signal);
    if (cancelled) return cancelled as Result<AnalysisResult>;

    const scanResult = await measureAnalysisPerformance(
      this.performanceRecorder,
      AnalysisPerformanceStages.RepositoryScan,
      () => this.scanRepository(rootPath, changedPaths, previous, startTime, signal),
    );
    if (isErr(scanResult)) return scanResult;

    const parsed = await measureAnalysisPerformance(
      this.performanceRecorder,
      AnalysisPerformanceStages.AstAnalysis,
      () =>
        this.parseRepositoryFiles(
          rootPath,
          scanResult.value,
          { previous, changedPaths },
          startTime,
          signal,
        ),
    );
    if (isErr(parsed)) return parsed;

    const stages = await this.runCoreStages(
      rootPath,
      scanResult.value.repository,
      parsed.value.files,
      changedPaths,
      previous,
      startTime,
      signal,
    );
    if (isErr(stages)) return stages;

    const durationMs = Date.now() - startTime;
    this.emitProgress(PipelineStage.GeneratingKnowledge, 'Core analysis complete.', 1);
    this.logger.info(`Core analysis complete in ${durationMs}ms`);
    return Ok({
      repository: scanResult.value.repository,
      files: parsed.value.files,
      graph: stages.value.graph,
      architecture: stages.value.architecture,
      knowledge: stages.value.knowledge,
      coverage: parsed.value.coverage,
      durationMs,
      scan: scanResult.value,
      failedPaths: parsed.value.failedPaths,
      dirtyPaths: stages.value.dirtyPaths,
    });
  }

  private async scanRepository(
    rootPath: string,
    changedPaths: readonly string[],
    previous: AnalysisResult | undefined,
    startTime: number,
    signal?: AbortSignal,
  ): Promise<Result<RepositoryScanResult>> {
    this.emitProgress(PipelineStage.Scanning, 'Scanning repository...', 0);
    this.eventBus.emit(DNAEventNames.ScanStarted, { rootPath, timestamp: Date.now() });

    const result =
      previous?.scan?.manifest && this.scanner.scanIncremental
        ? await this.scanner.scanIncremental(
            { rootPath, previous: previous.scan, changedPaths },
            signal,
          )
        : await this.scanner.scan(rootPath, signal);
    if (isErr(result)) return this.handleStageError('Scanning', result.error);

    this.eventBus.emit(DNAEventNames.ScanComplete, {
      rootPath,
      fileCount: result.value.repository.totalFiles,
      languageCount: result.value.repository.languages.length,
      durationMs: Date.now() - startTime,
    });
    return result;
  }

  private async parseRepositoryFiles(
    rootPath: string,
    scan: RepositoryScanResult,
    context: ParseContext,
    startTime: number,
    signal?: AbortSignal,
  ): Promise<Result<ParsedFiles>> {
    const cancelled = this.checkCancelled(signal);
    if (cancelled) return cancelled as Result<ParsedFiles>;
    this.emitProgress(PipelineStage.Parsing, 'Parsing source files...', 0);

    const supportedLanguages = new Set(this.astEngine.getSupportedLanguages());
    const supportedFiles = scan.files.filter((file) => supportedLanguages.has(file.language));
    const currentPaths = new Set(
      supportedFiles.map((file) => normalizeRelativePath(file.relativePath)),
    );
    const previousFiles = new Map(
      (context.previous?.files ?? []).map(
        (file) => [normalizeRelativePath(file.path), file] as const,
      ),
    );
    const changed = new Set(
      context.changedPaths.map((filePath) => relativePathKey(rootPath, filePath)),
    );
    const currentManifest = manifestIndex(scan);
    const previousManifest = manifestIndex(context.previous?.scan);
    const previousFailed = new Set(
      (context.previous?.failedPaths ?? []).map(normalizeRelativePath),
    );
    const files: FileDNA[] = [];
    const failedPaths = new Set<string>();
    const inputs: FileInput[] = [];

    for (const file of supportedFiles) {
      const relativePath = normalizeRelativePath(file.relativePath);
      const previousFile = previousFiles.get(relativePath);
      const mustObserve =
        !context.previous ||
        !context.previous.scan?.manifest ||
        changed.has(pathComparisonKey(relativePath)) ||
        manifestEntryChanged(
          previousManifest.get(pathComparisonKey(relativePath)),
          currentManifest.get(pathComparisonKey(relativePath)),
        );

      if (!mustObserve) {
        if (previousFile) files.push(previousFile);
        else if (previousFailed.has(relativePath)) failedPaths.add(relativePath);
        else {
          const input = await this.readInput(file, failedPaths);
          if (input) inputs.push(input);
        }
        continue;
      }

      const input = await this.readInput(file, failedPaths);
      if (!input) continue;
      const contentHash = createHash('sha256').update(input.content).digest('hex');
      if (previousFile?.hash === contentHash && previousFile.language === input.language) {
        files.push(previousFile);
      } else {
        inputs.push(input);
      }
    }

    this.eventBus.emit(DNAEventNames.AstParseStarted, { totalFiles: inputs.length });
    let processed = 0;
    for await (const parseResult of this.astEngine.parseFiles(inputs, signal)) {
      const input = inputs[processed];
      if (input) inputs[processed] = releaseInputContent(input);
      processed++;
      if (isErr(parseResult)) {
        if (input?.relativePath) failedPaths.add(normalizeRelativePath(input.relativePath));
        this.logger.warn(`Failed to parse ${input?.relativePath ?? 'file'}: ${parseResult.error}`);
        continue;
      }
      files.push(parseResult.value.fileDna);
      this.eventBus.emit(DNAEventNames.AstParseProgress, {
        filePath: parseResult.value.fileDna.path,
        current: processed,
        total: inputs.length,
      });
    }
    if (signal?.aborted) return this.checkCancelled(signal) as Result<ParsedFiles>;
    for (const input of inputs.slice(processed)) {
      if (input.relativePath) failedPaths.add(normalizeRelativePath(input.relativePath));
    }
    inputs.length = 0;

    const orderedFiles = files
      .filter((file) => currentPaths.has(normalizeRelativePath(file.path)))
      .sort((left, right) => left.path.localeCompare(right.path));
    const orderedFailures = [...failedPaths]
      .filter((filePath) => currentPaths.has(filePath))
      .sort();
    const coverage = {
      scanned: scan.repository.totalFiles,
      parsed: orderedFiles.length,
      skipped: Math.max(0, scan.repository.totalFiles - supportedFiles.length),
      failed: orderedFailures.length,
    };
    this.eventBus.emit(DNAEventNames.AstParseComplete, {
      filesProcessed: orderedFiles.length,
      durationMs: Date.now() - startTime,
    });
    return Ok({ files: orderedFiles, failedPaths: orderedFailures, coverage });
  }

  private async readInput(
    file: RepositoryScanResult['files'][number],
    failedPaths: Set<string>,
  ): Promise<FileInput | null> {
    try {
      return {
        path: file.path,
        relativePath: file.relativePath,
        content: await readFile(file.path, 'utf8'),
        language: file.language,
      };
    } catch (error) {
      failedPaths.add(normalizeRelativePath(file.relativePath));
      this.logger.warn(`Failed to read ${file.relativePath}: ${String(error)}`);
      return null;
    }
  }

  private async runCoreStages(
    rootPath: string,
    repository: RepositoryDNA,
    files: FileDNA[],
    changedPaths: readonly string[],
    previous: AnalysisResult | undefined,
    startTime: number,
    signal?: AbortSignal,
  ): Promise<Result<CoreStages>> {
    let cancelled = this.checkCancelled(signal);
    if (cancelled) return cancelled as Result<CoreStages>;
    this.emitProgress(PipelineStage.ResolvingDependencies, 'Building dependency graph...', 0);

    const graphResult = await measureAnalysisPerformance(
      this.performanceRecorder,
      AnalysisPerformanceStages.DependencyGraph,
      () =>
        previous && this.dependencyEngine.buildDependencyGraphIncremental
          ? this.dependencyEngine.buildDependencyGraphIncremental(
              {
                files,
                previousFiles: previous.files,
                previousGraph: previous.graph,
                rootPath,
                changedPaths,
              },
              signal,
            )
          : this.dependencyEngine.buildDependencyGraph(files, rootPath, signal),
    );
    if (isErr(graphResult))
      return this.handleStageError('ResolvingDependencies', graphResult.error);
    const graph = graphResult.value;
    const circularDependencies = measureAnalysisPerformanceSync(
      this.performanceRecorder,
      AnalysisPerformanceStages.CircularDependencies,
      () => this.dependencyEngine.detectCircularDependencies(graph),
    );
    this.eventBus.emit(DNAEventNames.DependenciesResolved, {
      nodeCount: graph.nodeCount,
      edgeCount: graph.edgeCount,
      circularDependencyCount: circularDependencies.length,
      durationMs: Date.now() - startTime,
    });

    cancelled = this.checkCancelled(signal);
    if (cancelled) return cancelled as Result<CoreStages>;
    this.emitProgress(PipelineStage.InferringArchitecture, 'Inferring architecture...', 0);
    const architectureResult = await measureAnalysisPerformance(
      this.performanceRecorder,
      AnalysisPerformanceStages.ArchitectureInference,
      () => this.architectureEngine.inferArchitecture(graph, repository, signal),
    );
    if (isErr(architectureResult))
      return this.handleStageError('InferringArchitecture', architectureResult.error);
    const architecture = architectureResult.value;
    this.eventBus.emit(DNAEventNames.ArchitectureInferred, {
      pattern: architecture.pattern,
      confidence: architecture.confidence,
      durationMs: Date.now() - startTime,
    });

    const dirtyPaths = measureAnalysisPerformanceSync(
      this.performanceRecorder,
      AnalysisPerformanceStages.DirtySetPlanning,
      () => calculateDirtyPaths(rootPath, changedPaths, files, previous, graph, architecture),
    );
    cancelled = this.checkCancelled(signal);
    if (cancelled) return cancelled as Result<CoreStages>;
    this.emitProgress(PipelineStage.GeneratingKnowledge, 'Generating knowledge...', 0);
    const knowledgeResult = await measureAnalysisPerformance(
      this.performanceRecorder,
      AnalysisPerformanceStages.KnowledgeGeneration,
      () =>
        previous && this.knowledgeEngine.generateKnowledgeIncremental
          ? this.knowledgeEngine.generateKnowledgeIncremental(
              {
                repository,
                files,
                graph,
                architecture,
                previous: previous.knowledge,
                dirtyPaths,
              },
              signal,
            )
          : this.knowledgeEngine.generateKnowledge(repository, files, graph, architecture, signal),
    );
    if (isErr(knowledgeResult))
      return this.handleStageError('GeneratingKnowledge', knowledgeResult.error);
    this.eventBus.emit(DNAEventNames.KnowledgeGenerated, {
      nodeCount: knowledgeResult.value.nodes.length,
      durationMs: Date.now() - startTime,
    });
    return Ok({ graph, architecture, knowledge: knowledgeResult.value, dirtyPaths });
  }

  private checkCancelled(signal?: AbortSignal): Result<void> | null {
    if (!signal?.aborted) return null;
    const error = new Error('Analysis cancelled');
    this.logger.info('Analysis cancelled by caller');
    this.eventBus.emit(DNAEventNames.AnalysisError, { stage: 'cancelled', error });
    return Err(error);
  }

  private emitProgress(stage: PipelineStage, message: string, stageProgress: number): void {
    this.eventBus.emit(DNAEventNames.AnalysisProgress, {
      stage,
      message,
      percent: calculateOverallProgress(stage, stageProgress),
      startedAt: Date.now(),
    });
  }

  private handleStageError<T>(stage: string, error: unknown): Result<T> {
    const resolvedError = error instanceof Error ? error : new Error(String(error));
    this.logger.error(`Pipeline failed at stage ${stage}: ${resolvedError.message}`);
    this.eventBus.emit(DNAEventNames.AnalysisError, { stage, error: resolvedError });
    return Err(resolvedError);
  }
}

function releaseInputContent(input: FileInput): FileInput {
  return input.content.length === 0 ? input : { ...input, content: '' };
}

function manifestIndex(scan?: RepositoryScanResult): Map<string, RepositoryManifestEntry> {
  return new Map(
    (scan?.manifest ?? []).map((entry) => [pathComparisonKey(entry.relativePath), entry] as const),
  );
}

function manifestEntryChanged(
  previous: RepositoryManifestEntry | undefined,
  current: RepositoryManifestEntry | undefined,
): boolean {
  return (
    !previous ||
    !current ||
    previous.size !== current.size ||
    previous.modifiedAtMs !== current.modifiedAtMs ||
    previous.language !== current.language ||
    previous.analyzable !== current.analyzable
  );
}

function calculateDirtyPaths(
  rootPath: string,
  changedPaths: readonly string[],
  files: readonly FileDNA[],
  previous: AnalysisResult | undefined,
  currentGraph: RepositoryGraph,
  currentArchitecture: ArchitectureDNA,
): string[] {
  const currentFilePaths = new Set(files.map((file) => normalizeRelativePath(file.path)));
  if (!previous || !architecturesEquivalent(previous.architecture, currentArchitecture)) {
    return [...currentFilePaths].sort();
  }

  const dirty = new Set(changedPaths.map((filePath) => relativePathKey(rootPath, filePath)));
  const traversalFileIds = new Set([
    ...previous.graph.getNodesByKind('file'),
    ...currentGraph.getNodesByKind('file'),
  ]);
  const traversal = traverseDependencyGraph({
    graphs: [previous.graph, currentGraph],
    startIds: [...dirty],
    options: {
      direction: 'connected',
      maxDepth: traversalFileIds.size,
      maxEntities: Math.max(1, traversalFileIds.size),
      missingStartNode: 'ignore',
    },
  });
  if (!traversal.ok) throw traversal.error;
  for (const node of traversal.value.nodes) dirty.add(normalizeRelativePath(node.id));
  return [...dirty].filter((filePath) => currentFilePaths.has(filePath)).sort();
}

function architecturesEquivalent(left: ArchitectureDNA, right: ArchitectureDNA): boolean {
  const { detectedAt: _leftDetectedAt, ...stableLeft } = left;
  const { detectedAt: _rightDetectedAt, ...stableRight } = right;
  return JSON.stringify(stableLeft) === JSON.stringify(stableRight);
}

function relativePathKey(rootPath: string, filePath: string): string {
  const absolutePath = path.resolve(filePath);
  const relativePath = path.isAbsolute(filePath) ? path.relative(rootPath, absolutePath) : filePath;
  return pathComparisonKey(relativePath);
}

function pathComparisonKey(value: string): string {
  const normalized = normalizeRelativePath(value);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/gu, '/').replace(/^\.\//u, '');
}
