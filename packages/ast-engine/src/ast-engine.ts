/** Main AST engine for deterministic TypeScript and JavaScript extraction. */

import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  ClassDNASchema,
  FileDNASchema,
  FunctionDNASchema,
  type FileInput,
  type IAstEngine,
  type ParseResult,
} from '@project-dna/dna-core';
import { Err, Ok, type Logger, type Result } from '@project-dna/shared';
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
import { TypeScriptParser } from './parsers/typescript-parser.js';

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

export class AstEngine implements IAstEngine {
  private readonly typescriptParser = new TypeScriptParser();
  private readonly treeSitterParser = new TreeSitterParser();
  private readonly multiLanguageExtractor = new MultiLanguageExtractor();
  private readonly pythonExtractor = new PythonExtractor();
  private readonly classExtractor = new ClassExtractor();
  private readonly functionExtractor = new FunctionExtractor();
  private readonly importExtractor = new ImportExtractor();
  private readonly exportExtractor = new ExportExtractor();
  private readonly commentExtractor = new CommentExtractor();

  constructor(private readonly logger: Logger) {}

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
      const parseResult = await this.parserFor(input.language).parse(input.content, input.language, input.path);
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
    } catch (error) {
      const resolvedError = error instanceof Error ? error : new Error(String(error));
      this.logger.warn(`Failed to parse ${input.path}: ${resolvedError.message}`);
      return Err(resolvedError);
    }
  }

  private parserFor(language: string): { parse(content: string, language: string, filePath: string): Promise<Result<RawParseTree>> } {
    return this.treeSitterParser.getSupportedLanguages().includes(language)
      ? this.treeSitterParser
      : this.typescriptParser;
  }

  public async *parseFiles(
    inputs: FileInput[],
    signal?: AbortSignal,
  ): AsyncGenerator<Result<ParseResult>> {
    for (const input of inputs) {
      if (signal?.aborted) {
        yield Err(new Error('AST parsing cancelled'));
        return;
      }
      yield await this.parseFile(input, signal);
    }
  }
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/gu, '/');
}
