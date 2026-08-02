/**
 * BusinessDomain — An inferred business domain within the repository.
 *
 * Domains are clusters of related code that serve a common business purpose.
 * Inferred from folder structure, naming conventions, and import clustering.
 * NO AI. Purely structural and lexical heuristics.
 */

import { z } from 'zod';

export const BusinessDomainSchema = z.object({
  /** Unique identifier for this domain. */
  id: z.string(),

  /** Human-readable domain name (e.g., "authentication", "billing", "user-management"). */
  name: z.string(),

  /** How the domain was inferred. */
  inferenceSource: z.enum(['folder-structure', 'naming-convention', 'import-clustering', 'composite']),

  /** Confidence in the domain inference (0-1). */
  confidence: z.number().min(0).max(1),

  /** Root directories belonging to this domain. */
  rootPaths: z.array(z.string()),

  /** DNAObject IDs belonging to this domain. */
  entityIds: z.array(z.string()),

  /** Number of files in this domain. */
  fileCount: z.number().int().nonnegative(),

  /** Number of lines of code in this domain. */
  linesOfCode: z.number().int().nonnegative(),

  /** Primary languages used in this domain. */
  primaryLanguages: z.array(z.string()),

  /** Domains this domain depends on (domain IDs). */
  dependsOn: z.array(z.string()),

  /** Domains that depend on this domain (domain IDs). */
  dependedOnBy: z.array(z.string()),

  /** When this domain was detected. */
  detectedAt: z.number(),
});

export type BusinessDomain = z.infer<typeof BusinessDomainSchema>;
