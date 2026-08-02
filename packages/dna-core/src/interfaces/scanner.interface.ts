/**
 * IRepositoryScanner — Contract for repository scanning.
 *
 * Implementations scan a repository root and extract metadata:
 * languages, frameworks, config files. They NEVER parse code or
 * perform any analysis beyond file-system observation.
 */

import type { Result } from '@project-dna/shared';
import type { RepositoryDNA } from '../models/repository-dna.js';

export interface IRepositoryScanner {
  /**
   * Scan a repository root and produce its DNA.
   *
   * @param rootPath - Absolute path to the repository root.
   * @returns RepositoryDNA with detected languages, frameworks, and metadata.
   */
  scan(rootPath: string, signal?: AbortSignal): Promise<Result<RepositoryDNA>>;
}
