/**
 * IRepositoryScanner — Contract for repository scanning.
 *
 * Implementations scan a repository root and extract metadata:
 * languages, frameworks, config files. They NEVER parse code or
 * perform any analysis beyond file-system observation.
 */

import type { Result } from '@project-dna/shared';
import type { RepositoryDNA } from '../models/repository-dna.js';

/** A source file discovered by the scanner and ready for the AST stage. */
export interface ScannedFile {
  /** Absolute path used for reading the file. */
  readonly path: string;
  /** Path relative to the repository root, normalized with forward slashes. */
  readonly relativePath: string;
  /** Detected language identifier. */
  readonly language: string;
  /** File size in bytes. */
  readonly size: number;
}

/** Complete scanner output: lightweight repository metadata plus a file manifest. */
export interface RepositoryScanResult {
  readonly repository: RepositoryDNA;
  readonly files: ScannedFile[];
}

export interface IRepositoryScanner {
  /**
   * Scan a repository root and produce its DNA.
   *
   * @param rootPath - Absolute path to the repository root.
   * @returns Repository metadata and the source-file manifest for the AST engine.
   */
  scan(rootPath: string, signal?: AbortSignal): Promise<Result<RepositoryScanResult>>;
}
