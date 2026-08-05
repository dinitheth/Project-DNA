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

/** A non-ignored file observed by the repository scanner. */
export interface RepositoryManifestEntry {
  /** Absolute path used for filesystem access. */
  readonly path: string;
  /** Repository-relative path normalized with forward slashes. */
  readonly relativePath: string;
  /** File size in bytes. */
  readonly size: number;
  /** Filesystem modification time used only as a change-detection hint. */
  readonly modifiedAtMs: number;
  /** Detected language identifier, when known. */
  readonly language?: string;
  /** Whether the file is within the scanner's source-analysis limits. */
  readonly analyzable: boolean;
  /** Non-blank line count observed by the scanner. */
  readonly linesOfCode: number;
}

/** Complete scanner output: lightweight repository metadata plus a file manifest. */
export interface RepositoryScanResult {
  readonly repository: RepositoryDNA;
  readonly files: ScannedFile[];
  /** Complete non-ignored file manifest used for incremental reconciliation. */
  readonly manifest?: RepositoryManifestEntry[];
}

/** Input for reconciling a known scanner result with changed filesystem paths. */
export interface IncrementalScanRequest {
  readonly rootPath: string;
  readonly previous: RepositoryScanResult;
  readonly changedPaths: readonly string[];
}

export interface IRepositoryScanner {
  /**
   * Scan a repository root and produce its DNA.
   *
   * @param rootPath - Absolute path to the repository root.
   * @returns Repository metadata and the source-file manifest for the AST engine.
   */
  scan(rootPath: string, signal?: AbortSignal): Promise<Result<RepositoryScanResult>>;

  /**
   * Reconcile changed paths against a previous complete scanner result.
   * Implementations may omit this capability; callers must then use a full scan.
   */
  scanIncremental?(
    request: IncrementalScanRequest,
    signal?: AbortSignal,
  ): Promise<Result<RepositoryScanResult>>;
}
