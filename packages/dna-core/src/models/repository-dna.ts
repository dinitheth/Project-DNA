/**
 * RepositoryDNA — The top-level model representing a scanned repository.
 *
 * This is the root of the DNA tree. It captures what a repository IS:
 * its languages, frameworks, structure, and metadata — without any
 * interpretation or analysis of meaning.
 */

import { z } from 'zod';
import { createHash } from 'node:crypto';
import path from 'node:path';

export const RepositoryDNASchema = z.object({
  /** Unique identifier (hash of rootPath). */
  id: z.string(),

  /** Repository name (typically the directory name). */
  name: z.string(),

  /** Absolute path to the repository root. */
  rootPath: z.string(),

  /** Programming languages detected, with file counts. */
  languages: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      fileCount: z.number().int().nonnegative(),
      percentage: z.number().min(0).max(100),
    }),
  ),

  /** Frameworks and libraries detected. */
  frameworks: z.array(
    z.object({
      name: z.string(),
      version: z.string().optional(),
      confidence: z.number().min(0).max(1),
    }),
  ),

  /** Package manager used (npm, pnpm, yarn, etc.). */
  packageManager: z.string().optional(),

  /** Repository metadata from config files. */
  metadata: z.object({
    hasReadme: z.boolean(),
    hasLicense: z.boolean(),
    hasGitIgnore: z.boolean(),
    hasTsConfig: z.boolean(),
    hasPackageJson: z.boolean(),
    description: z.string().optional(),
    version: z.string().optional(),
  }),

  /** Total file count (excluding ignored). */
  totalFiles: z.number().int().nonnegative(),

  /** Total lines of code (excluding ignored). */
  totalLinesOfCode: z.number().int().nonnegative(),

  /** When this DNA snapshot was created. */
  createdAt: z.number(),

  /** When this DNA snapshot was last updated. */
  updatedAt: z.number(),
});

export type RepositoryDNA = z.infer<typeof RepositoryDNASchema>;

/** Derive the canonical repository identity used by scanning and persistence recovery. */
export function createRepositoryId(rootPath: string): string {
  return createHash('sha256').update(path.resolve(rootPath).toLowerCase()).digest('hex');
}
