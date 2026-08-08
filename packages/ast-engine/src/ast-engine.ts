/** Main AST engine for deterministic TypeScript and JavaScript extraction. */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { availableParallelism, cpus } from 'node:os';
import path from 'node:path';
import type {
  FileInput,
  IAstEngine,
  ParseResult,
} from '@project-dna/dna-core/src/interfaces/ast-engine.interface.js';
import { ClassDNASchema } from '@project-dna/dna-core/src/models/class-dna.js';
import { FileDNASchema } from '@project-dna/dna-core/src/models/file-dna.js';
import { FunctionDNASchema } from '@project-dna/dna-core/src/models/function-dna.js';
import type { Logger } from '@project-dna/shared/src/logger/logger.js';
import { Err, Ok, type Result } from '@project-dna/shared/src/result/result.js';
import { ClassExtractor } from './extractors/class-extractor.js';
import { CommentExtractor } from './extractors/comment-extractor.js';
import { MultiLanguageExtractor } from './extractors/multi-language-extractor.js';
import { PythonExtractor } from './extractors/python-extractor.js';
import { ExportExtractor } from './extractors/export-extractor.js';
import { FunctionExtractor } from './extractors/function-extractor.js';
import { ImportExtractor } from './extractors/import-extractor.js';
import { calculateComplexity, countCodeLines } from './extractors/utils.js';
import { isTypeScriptParseTree, type RawParseTree } from './parsers/parser.interface.js';
import { TreeSitterParser } from './parsers/tree-sitter-parser.js';
import { ManagedTypeScriptParser } from './parsers/typescript-parser.js';
import {
  AstWorkerPoolCancelledError,
  DeterministicAstWorkerPool,
} from './workers/ast-worker-pool.js';

const SUPPORTED_LANGUAGES = [
  'typescript',
  'typescriptreact',
  'javascript',
  'javascriptreact',
  'csharp',
  'go',
  'java',
  'python',
  'rust',
] as const;

const MAX_WORKER_COUNT = 4;
const DEFAULT_MINIMUM_PARALLEL_FILES = 256;

export interface AstEngineOptions {
  /** Maximum AST workers. A value of one forces sequential parsing. */
  readonly workerCount?: number;
  /** Minimum batch size required before worker startup is worthwhile. */
  readonly minimumParallelFiles?: number;
  /** Explicit bundled worker entry point. Startup failures fall back sequentially. */
  readonly workerScriptPath?: string;
}

export class AstEngine implements IAstEngine {
  private readonly typescriptParser = new ManagedTypeScriptParser();
  private readonly treeSitterParser = new TreeSitterParser();
  private readonly multiLanguageExtractor = new MultiLanguageExtractor();
  private readonly pythonExtractor = new PythonExtractor();
  private readonly classExtractor = new ClassExtractor();
  private readonly functionExtractor = new FunctionExtractor();
  private readonly importExtractor = new ImportExtractor();
  private readonly exportExtractor = new ExportExtractor();
  private readonly commentExtractor = new CommentExtractor();
  private readonly workerCount: number;
  private readonly minimumParallelFiles: number;
  private readonly workerScriptPath: string | null;

  constructor(
    private readonly logger: Logger,
    options: AstEngineOptions = {},
  ) {
    this.workerCount = resolveWorkerCount(options.workerCount);
    this.minimumParallelFiles = resolveMinimumParallelFiles(options.minimumParallelFiles);
    this.workerScriptPath = resolveWorkerScriptPath(options.workerScriptPath);
  }

  public getSupportedLanguages(): string[] {
    return [...SUPPORTED_LANGUAGES];
  }

  public async parseFile(input: FileInput, signal?: AbortSignal): Promise<Result<ParseResult>> {
    if (signal?.aborted) return Err(new Error('AST parsing cancelled'));
    if (!this.getSupportedLanguages().includes(input.language)) {
      return Err(new Error(`Unsupported AST language: ${input.language}`));
    }

    try {
      const persistedPath = normalizePath(input.relativePath ?? path.basename(input.path));
      const parseResult = await this.parserFor(input.language).parse(
        input.content,
        input.language,
        input.path,
      );
      if (!parseResult.ok) return parseResult;
      if (signal?.aborted) return Err(new Error('AST parsing cancelled'));

      const tree = parseResult.value;
      if (!isTypeScriptParseTree(tree)) {
        try {
          const extracted =
            tree.language === 'python'
              ? this.pythonExtractor.extract(tree, persistedPath)
              : this.multiLanguageExtractor.extract(tree, persistedPath);
          const contentHash = createHash('sha256').update(input.content).digest('hex');
          const fileDna = FileDNASchema.parse({
            id: createHash('sha256').update(`${persistedPath}:${contentHash}`).digest('hex'),
            path: persistedPath,
            language: input.language,
            hash: contentHash,
            size: Buffer.byteLength(input.content, 'utf8'),
            linesOfCode: extracted.linesOfCode,
            classIds: extracted.classes.map((classDna) => classDna.id),
            functionIds: extracted.functions.map((functionDna) => functionDna.id),
            imports: extracted.imports,
            exports: extracted.exports,
            comments: extracted.comments,
            complexity: extracted.complexity,
          });
          return Ok({ fileDna, classes: extracted.classes, functions: extracted.functions });
        } finally {
          tree.tree.delete();
        }
      }
      try {
        const classes = this.classExtractor
          .extract(tree, persistedPath)
          .map((classDna) => ClassDNASchema.parse(classDna));
        const functions = this.functionExtractor
          .extract(tree, persistedPath)
          .map((functionDna) => FunctionDNASchema.parse(functionDna));
        const contentHash = createHash('sha256').update(input.content).digest('hex');
        const fileDna = FileDNASchema.parse({
          id: createHash('sha256').update(`${persistedPath}:${contentHash}`).digest('hex'),
          path: persistedPath,
          language: input.language,
          hash: contentHash,
          size: Buffer.byteLength(input.content, 'utf8'),
          linesOfCode: countCodeLines(input.content),
          classIds: classes.map((classDna) => classDna.id),
          functionIds: functions.map((functionDna) => functionDna.id),
          imports: this.importExtractor.extract(tree),
          exports: this.exportExtractor.extract(tree),
          comments: this.commentExtractor.extract(tree),
          complexity: calculateComplexity(tree.sourceFile),
        });

        return Ok({ fileDna, classes, functions });
      } finally {
        this.typescriptParser.release(tree);
      }
    } catch (error) {
      const resolvedError = error instanceof Error ? error : new Error(String(error));
      this.logger.warn(`Failed to parse ${input.path}: ${resolvedError.message}`);
      return Err(resolvedError);
    }
  }

  private parserFor(language: string): {
    parse(content: string, language: string, filePath: string): Promise<Result<RawParseTree>>;
  } {
    return this.treeSitterParser.getSupportedLanguages().includes(language)
      ? this.treeSitterParser
      : this.typescriptParser;
  }

  public async *parseFiles(
    inputs: FileInput[],
    signal?: AbortSignal,
  ): AsyncGenerator<Result<ParseResult>> {
    let parsedInParallel = 0;
    if (this.canParseInParallel(inputs)) {
      try {
        const pool = new DeterministicAstWorkerPool({
          workerCount: this.workerCount,
          workerScriptPath: this.workerScriptPath!,
        });
        for await (const result of pool.parseAndRelease(inputs, signal)) {
          if (signal?.aborted) {
            yield Err(new Error('AST parsing cancelled'));
            return;
          }
          parsedInParallel++;
          yield result;
        }
        return;
      } catch (error) {
        if (error instanceof AstWorkerPoolCancelledError || signal?.aborted) {
          yield Err(new Error('AST parsing cancelled'));
          return;
        }
        const resolved = error instanceof Error ? error : new Error(String(error));
        this.logger.warn(
          `Parallel AST parsing unavailable; retrying sequentially: ${resolved.message}`,
        );
      }
    }

    for (let index = parsedInParallel; index < inputs.length; index++) {
      const input = inputs[index];
      if (!input) continue;
      if (signal?.aborted) {
        yield Err(new Error('AST parsing cancelled'));
        return;
      }
      yield await this.parseFile(input, signal);
    }
  }

  private canParseInParallel(inputs: readonly FileInput[]): boolean {
    return (
      this.workerCount > 1 &&
      inputs.length >= this.minimumParallelFiles &&
      this.workerScriptPath !== null
    );
  }
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/gu, '/');
}

function resolveWorkerCount(configured: number | undefined): number {
  const environmentValue = Number.parseInt(process.env['PROJECT_DNA_AST_WORKERS'] ?? '', 10);
  const requested =
    configured ?? (Number.isFinite(environmentValue) ? environmentValue : undefined);
  if (requested !== undefined) {
    if (!Number.isInteger(requested) || requested < 1) return 1;
    return Math.min(requested, MAX_WORKER_COUNT);
  }
  const cpuCount =
    typeof availableParallelism === 'function' ? availableParallelism() : cpus().length;
  return Math.max(1, Math.min(MAX_WORKER_COUNT, cpuCount - 1));
}

function resolveMinimumParallelFiles(configured: number | undefined): number {
  if (configured === undefined) return DEFAULT_MINIMUM_PARALLEL_FILES;
  return Number.isInteger(configured) && configured > 0
    ? configured
    : DEFAULT_MINIMUM_PARALLEL_FILES;
}

function resolveWorkerScriptPath(configured: string | undefined): string | null {
  if (configured?.trim()) return path.resolve(configured);

  const environmentPath = process.env['PROJECT_DNA_AST_WORKER_PATH'];
  if (environmentPath?.trim()) return path.resolve(environmentPath);

  const candidates = [
    path.join(__dirname, 'ast-worker.js'),
    path.resolve(process.cwd(), 'dist', 'ast-worker.js'),
  ];
  return (
    candidates.find((candidate): candidate is string =>
      Boolean(candidate && existsSync(candidate)),
    ) ?? null
  );
}
