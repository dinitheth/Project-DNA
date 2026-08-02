/**
 * RepositoryProfile — The software identity of a repository.
 *
 * Describes WHAT a repository IS at the product level:
 * project type, maturity, primary technologies, and infrastructure.
 */

import { z } from 'zod';

export const ProjectTypeSchema = z.enum([
  'library',
  'application',
  'monorepo',
  'framework',
  'cli-tool',
  'plugin',
  'service',
  'unknown',
]);

export type ProjectType = z.infer<typeof ProjectTypeSchema>;

export const RepositorySizeSchema = z.enum(['tiny', 'small', 'medium', 'large', 'massive']);
export type RepositorySize = z.infer<typeof RepositorySizeSchema>;

export const LanguageBreakdownSchema = z.object({
  /** Language identifier. */
  language: z.string(),
  /** Percentage of codebase. */
  percentage: z.number().min(0).max(100),
  /** Number of files. */
  fileCount: z.number().int().nonnegative(),
  /** Total lines of code. */
  linesOfCode: z.number().int().nonnegative(),
});

export type LanguageBreakdown = z.infer<typeof LanguageBreakdownSchema>;

export const FrameworkDetectionSchema = z.object({
  /** Framework name. */
  name: z.string(),
  /** Detected version (if available). */
  version: z.string().nullable(),
  /** Detection confidence (0-1). */
  confidence: z.number().min(0).max(1),
  /** Category of framework. */
  category: z.enum(['frontend', 'backend', 'testing', 'build', 'orm', 'other']),
});

export type FrameworkDetection = z.infer<typeof FrameworkDetectionSchema>;

export const MaturityIndicatorsSchema = z.object({
  /** Has CI/CD configuration. */
  hasCi: z.boolean(),
  /** Has automated tests. */
  hasTests: z.boolean(),
  /** Has linting/formatting configuration. */
  hasLinting: z.boolean(),
  /** Has documentation (README, docs folder). */
  hasDocumentation: z.boolean(),
  /** Has changelog. */
  hasChangelog: z.boolean(),
  /** Has contribution guidelines. */
  hasContributing: z.boolean(),
  /** Uses semantic versioning. */
  usesSemver: z.boolean(),
  /** Has Docker configuration. */
  hasDocker: z.boolean(),
});

export type MaturityIndicators = z.infer<typeof MaturityIndicatorsSchema>;

export const RepositoryProfileSchema = z.object({
  /** Repository name. */
  name: z.string(),

  /** Inferred description of the repository's purpose. */
  description: z.string(),

  /** Primary languages with breakdowns. */
  primaryLanguages: z.array(LanguageBreakdownSchema),

  /** Detected frameworks and libraries. */
  frameworks: z.array(FrameworkDetectionSchema),

  /** Inferred project type. */
  projectType: ProjectTypeSchema,

  /** Package manager (npm, pnpm, yarn, etc.). */
  packageManager: z.string().nullable(),

  /** Detected test framework. */
  testFramework: z.string().nullable(),

  /** Detected CI system. */
  ciSystem: z.string().nullable(),

  /** Repository size classification. */
  repositorySize: RepositorySizeSchema,

  /** Maturity indicators. */
  maturityIndicators: MaturityIndicatorsSchema,
});

export type RepositoryProfile = z.infer<typeof RepositoryProfileSchema>;
