/**
 * FileDNA — Per-file analysis result from the AST engine.
 *
 * Captures everything the parser extracts from a single source file:
 * its symbols (classes, functions, imports, exports), structural
 * metadata (language, size, hash), and complexity metrics.
 */

import { z } from 'zod';

export const FileDNASchema = z.object({
  /** Unique identifier (hash of file path + content hash). */
  id: z.string(),

  /** Path relative to repository root. */
  path: z.string(),

  /** Detected language identifier. */
  language: z.string(),

  /** SHA-256 hash of file contents for change detection. */
  hash: z.string(),

  /** File size in bytes. */
  size: z.number().int().nonnegative(),

  /** Total lines of code (excluding blank lines and comments). */
  linesOfCode: z.number().int().nonnegative(),

  /** IDs of classes defined in this file. */
  classIds: z.array(z.string()),

  /** IDs of top-level functions defined in this file. */
  functionIds: z.array(z.string()),

  /** Import statements. */
  imports: z.array(
    z.object({
      source: z.string(),
      specifiers: z.array(
        z.object({
          name: z.string(),
          alias: z.string().optional(),
          isDefault: z.boolean(),
          isNamespace: z.boolean(),
        }),
      ),
      isTypeOnly: z.boolean(),
      isDynamic: z.boolean(),
    }),
  ),

  /** Export statements. */
  exports: z.array(
    z.object({
      name: z.string(),
      type: z.enum(['named', 'default', 'namespace', 're-export', 'barrel']),
      isTypeOnly: z.boolean(),
      source: z.string().optional(),
    }),
  ),

  /** Comment blocks (doc comments, inline, block). */
  comments: z.array(
    z.object({
      text: z.string(),
      type: z.enum(['line', 'block', 'doc']),
      startLine: z.number().int().positive(),
      endLine: z.number().int().positive(),
    }),
  ),

  /** Aggregate cyclomatic complexity for the file. */
  complexity: z.number().nonnegative(),
});

export type FileDNA = z.infer<typeof FileDNASchema>;
