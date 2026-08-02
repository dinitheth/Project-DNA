/**
 * DependencyDNA — Represents a dependency relationship between two files.
 *
 * This is the edge type in the dependency graph. Each edge captures
 * the nature of the import: static, dynamic, type-only, etc.
 */

import { z } from 'zod';

export const DependencyDNASchema = z.object({
  /** Unique identifier for this dependency edge. */
  id: z.string(),

  /** Source file path (the file that imports). */
  source: z.string(),

  /** Target file path (the file being imported). */
  target: z.string(),

  /** Type of dependency. */
  type: z.enum(['import', 're-export', 'dynamic-import', 'require', 'type-import']),

  /** Whether this is a type-only import (TypeScript). */
  isTypeOnly: z.boolean(),

  /** Specific symbols imported. */
  specifiers: z.array(
    z.object({
      name: z.string(),
      alias: z.string().optional(),
      isDefault: z.boolean(),
    }),
  ),

  /** Whether the target is an external package (node_modules). */
  isExternal: z.boolean(),

  /** The raw import specifier as written in source code. */
  rawSpecifier: z.string(),
});

export type DependencyDNA = z.infer<typeof DependencyDNASchema>;
