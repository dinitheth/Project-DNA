/**
 * ModuleDNA — Represents a logical module/package within a repository.
 *
 * A module is a cohesive grouping of files: it could be an npm package,
 * a directory namespace, or a domain boundary. Modules form the
 * mid-level structure between the repository and individual files.
 */

import { z } from 'zod';

export const ModuleDNASchema = z.object({
  /** Unique identifier. */
  id: z.string(),

  /** Module name (package name or directory name). */
  name: z.string(),

  /** Path relative to the repository root. */
  path: z.string(),

  /** What kind of module this is. */
  type: z.enum(['package', 'directory', 'namespace']),

  /** File IDs belonging to this module. */
  fileIds: z.array(z.string()),

  /** IDs of modules this module depends on. */
  dependencyIds: z.array(z.string()),

  /** Public exports from this module. */
  exports: z.array(
    z.object({
      name: z.string(),
      type: z.enum(['function', 'class', 'interface', 'type', 'variable', 'enum', 'namespace', 'default', 'barrel']),
      filePath: z.string(),
    }),
  ),

  /** Optional package.json metadata if this is an npm package. */
  packageInfo: z
    .object({
      version: z.string().optional(),
      description: z.string().optional(),
      main: z.string().optional(),
      types: z.string().optional(),
    })
    .optional(),
});

export type ModuleDNA = z.infer<typeof ModuleDNASchema>;
