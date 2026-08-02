/**
 * DNAOrchestrator — The pipeline controller.
 *
 * Receives all engine interfaces via DI. Orchestrates the full analysis
 * pipeline: scan → parse → resolve deps → infer architecture → generate knowledge.
 * Uses the event bus to coordinate stages and report progress.
 *
 * Design decisions:
 * - Engines are injected, never imported directly.
 * - Each stage validates its inputs and short-circuits on error.
 * - Progress is reported via the event bus, not direct callbacks.
 * - The orchestrator is stateless between runs.
 */

import type { EventBus, Logger, Result } from '@project-dna/shared';
import { Ok, Err, isErr, DNAEventNames } from '@project-dna/shared';
import type { DNAEventMap } from '@project-dna/shared';
import type { IRepositoryScanner } from '../interfaces/scanner.interface.js';
import type { IAstEngine, FileInput } from '../interfaces/ast-engine.interface.js';
import type { IDependencyEngine } from '../interfaces/dependency-engine.interface.js';
import type { IArchitectureEngine } from '../interfaces/architecture-engine.interface.js';
import type { IKnowledgeEngine, KnowledgeResult } from '../interfaces/knowledge-engine.interface.js';
import type { RepositoryDNA } from '../models/repository-dna.js';
import type { FileDNA } from '../models/file-dna.js';
import type { RepositoryGraph } from '../models/repository-graph.js';
import type { ArchitectureDNA } from '../models/architecture-dna.js';
import { PipelineStage, calculateOverallProgress } from './pipeline.js';

/** Complete analysis result from a full pipeline run. */
export interface AnalysisResult {
  repository: RepositoryDNA;
  files: FileDNA[];
  graph: RepositoryGraph;
  architecture: ArchitectureDNA;
  knowledge: KnowledgeResult;
  durationMs: number;
}

export interface OrchestratorDependencies {
  scanner: IRepositoryScanner;
  astEngine: IAstEngine;
  dependencyEngine: IDependencyEngine;
  architectureEngine: IArchitectureEngine;
  knowledgeEngine: IKnowledgeEngine;
  eventBus: EventBus<DNAEventMap>;
  logger: Logger;
}

export class DNAOrchestrator {
  private readonly scanner: IRepositoryScanner;
  private readonly astEngine: IAstEngine;
  private readonly dependencyEngine: IDependencyEngine;
  private readonly architectureEngine: IArchitectureEngine;
  private readonly knowledgeEngine: IKnowledgeEngine;
  private readonly eventBus: EventBus<DNAEventMap>;
  private readonly logger: Logger;

  constructor(deps: OrchestratorDependencies) {
    this.scanner = deps.scanner;
    this.astEngine = deps.astEngine;
    this.dependencyEngine = deps.dependencyEngine;
    this.architectureEngine = deps.architectureEngine;
    this.knowledgeEngine = deps.knowledgeEngine;
    this.eventBus = deps.eventBus;
    this.logger = deps.logger;
  }

  /**
   * Run the complete analysis pipeline on a repository.
   *
   * @param rootPath - Absolute path to the repository root.
   * @returns Complete analysis results, or an error if any stage fails.
   */
  async analyzeRepository(rootPath: string, signal?: AbortSignal): Promise<Result<AnalysisResult>> {
    const startTime = Date.now();
    this.logger.info(`Starting analysis of ${rootPath}`);

    // ── Stage 1: Scan Repository ──────────────────────────────────
    let cancelled = this.checkCancelled(signal);
    if (cancelled) return cancelled as Result<AnalysisResult>;

    this.emitProgress(PipelineStage.Scanning, 'Scanning repository...', 0);
    this.eventBus.emit(DNAEventNames.ScanStarted, {
      rootPath,
      timestamp: Date.now(),
    });

    const scanResult = await this.scanner.scan(rootPath, signal);
    if (isErr(scanResult)) {
      return this.handleStageError('Scanning', scanResult.error);
    }

    const repository = scanResult.value;
    this.eventBus.emit(DNAEventNames.ScanComplete, {
      rootPath,
      fileCount: repository.totalFiles,
      languageCount: repository.languages.length,
      durationMs: Date.now() - startTime,
    });

    // ── Stage 2: Parse Files ──────────────────────────────────────
    cancelled = this.checkCancelled(signal);
    if (cancelled) return cancelled as Result<AnalysisResult>;

    this.emitProgress(PipelineStage.Parsing, 'Parsing source files...', 0);

    // TODO: Implement file reading and create FileInput[] from scanned files.
    // This requires the scanner to provide file paths, which the orchestrator
    // reads from disk and passes to the AST engine.
    const fileInputs: FileInput[] = [];
    // TODO: Read file contents from disk for each file discovered by scanner.
    // for (const filePath of repository.filePaths) {
    //   const content = await fs.readFile(filePath, 'utf-8');
    //   fileInputs.push({ path: filePath, content, language: detectLanguage(filePath) });
    // }

    this.eventBus.emit(DNAEventNames.AstParseStarted, {
      totalFiles: fileInputs.length,
    });

    const files: FileDNA[] = [];
    let parsedCount = 0;

    for await (const parseResult of this.astEngine.parseFiles(fileInputs, signal)) {
      parsedCount++;
      if (isErr(parseResult)) {
        this.logger.warn(`Failed to parse file: ${parseResult.error}`);
        continue;
      }
      files.push(parseResult.value.fileDna);

      this.eventBus.emit(DNAEventNames.AstParseProgress, {
        filePath: parseResult.value.fileDna.path,
        current: parsedCount,
        total: fileInputs.length,
      });
    }

    this.eventBus.emit(DNAEventNames.AstParseComplete, {
      filesProcessed: files.length,
      durationMs: Date.now() - startTime,
    });

    // ── Stage 3: Resolve Dependencies ─────────────────────────────
    cancelled = this.checkCancelled(signal);
    if (cancelled) return cancelled as Result<AnalysisResult>;

    this.emitProgress(PipelineStage.ResolvingDependencies, 'Building dependency graph...', 0);

    const graphResult = await this.dependencyEngine.buildDependencyGraph(files, rootPath, signal);
    if (isErr(graphResult)) {
      return this.handleStageError('ResolvingDependencies', graphResult.error);
    }

    const graph = graphResult.value;
    const circularDeps = this.dependencyEngine.detectCircularDependencies(graph);

    this.eventBus.emit(DNAEventNames.DependenciesResolved, {
      nodeCount: graph.nodeCount,
      edgeCount: graph.edgeCount,
      circularDependencyCount: circularDeps.length,
      durationMs: Date.now() - startTime,
    });

    // ── Stage 4: Infer Architecture ───────────────────────────────
    cancelled = this.checkCancelled(signal);
    if (cancelled) return cancelled as Result<AnalysisResult>;

    this.emitProgress(PipelineStage.InferringArchitecture, 'Inferring architecture...', 0);

    const archResult = await this.architectureEngine.inferArchitecture(graph, repository, signal);
    if (isErr(archResult)) {
      return this.handleStageError('InferringArchitecture', archResult.error);
    }

    const architecture = archResult.value;
    this.eventBus.emit(DNAEventNames.ArchitectureInferred, {
      pattern: architecture.pattern,
      confidence: architecture.confidence,
      durationMs: Date.now() - startTime,
    });

    // ── Stage 5: Generate Knowledge ───────────────────────────────
    cancelled = this.checkCancelled(signal);
    if (cancelled) return cancelled as Result<AnalysisResult>;

    this.emitProgress(PipelineStage.GeneratingKnowledge, 'Generating knowledge...', 0);

    const knowledgeResult = await this.knowledgeEngine.generateKnowledge(
      repository,
      files,
      graph,
      architecture,
      signal,
    );
    if (isErr(knowledgeResult)) {
      return this.handleStageError('GeneratingKnowledge', knowledgeResult.error);
    }

    const knowledge = knowledgeResult.value;
    this.eventBus.emit(DNAEventNames.KnowledgeGenerated, {
      nodeCount: knowledge.nodes.length,
      durationMs: Date.now() - startTime,
    });

    // ── Complete ──────────────────────────────────────────────────
    const durationMs = Date.now() - startTime;
    this.emitProgress(PipelineStage.Complete, 'Analysis complete.', 1);
    this.logger.info(`Analysis complete in ${durationMs}ms`);

    return Ok({
      repository,
      files,
      graph,
      architecture,
      knowledge,
      durationMs,
    });
  }

  private checkCancelled(signal?: AbortSignal): Result<void> | null {
    if (signal?.aborted) {
      const err = new Error('Analysis cancelled');
      this.logger.info('Analysis cancelled by caller');
      this.eventBus.emit(DNAEventNames.AnalysisError, { stage: 'cancelled', error: err });
      return Err(err);
    }
    return null;
  }

  private emitProgress(stage: PipelineStage, message: string, stageProgress: number): void {
    this.eventBus.emit(DNAEventNames.AnalysisProgress, {
      stage,
      message,
      percent: calculateOverallProgress(stage, stageProgress),
    });
  }

  private handleStageError<T>(stage: string, error: unknown): Result<T> {
    const err = error instanceof Error ? error : new Error(String(error));
    this.logger.error(`Pipeline failed at stage ${stage}: ${err.message}`);
    this.eventBus.emit(DNAEventNames.AnalysisError, { stage, error: err });
    return Err(err);
  }
}
