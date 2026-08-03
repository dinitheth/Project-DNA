/**
 * IAstEngine — Contract for source code parsing.
 *
 * Implementations parse source files and extract structural information
 * (classes, functions, imports, exports, etc.) into FileDNA.
 * They NEVER analyze business meaning or generate summaries.
 */

import type { Result } from '@project-dna/shared';
import type { FileDNA } from '../models/file-dna.js';
import type { ClassDNA } from '../models/class-dna.js';
import type { FunctionDNA } from '../models/function-dna.js';

export interface FileInput {
  /** Absolute file path. */
  path: string;
  /** Repository-relative path used in persisted DNA. */
  relativePath?: string;
  /** File content as a string. */
  content: string;
  /** Language identifier. */
  language: string;
}

export interface ParseResult {
  /** The complete file DNA. */
  fileDna: FileDNA;
  /** Extracted classes. */
  classes: ClassDNA[];
  /** Extracted top-level functions. */
  functions: FunctionDNA[];
}

export interface IAstEngine {
  /**
   * Parse a single file.
   *
   * @param input - File path, content, and language.
   * @returns Parsed FileDNA with extracted symbols.
   */
  parseFile(input: FileInput, signal?: AbortSignal): Promise<Result<ParseResult>>;

  /**
   * Parse multiple files as an async generator for streaming results.
   *
   * @param inputs - Array of file inputs.
   * @yields Individual parse results as they complete.
   */
  parseFiles(inputs: FileInput[], signal?: AbortSignal): AsyncGenerator<Result<ParseResult>>;

  /**
   * Get the list of languages this engine can parse.
   */
  getSupportedLanguages(): string[];
}
