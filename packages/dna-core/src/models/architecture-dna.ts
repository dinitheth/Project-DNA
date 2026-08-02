/**
 * ArchitectureDNA — The inferred architectural pattern of a repository.
 *
 * Determined entirely by heuristics — folder naming, dependency direction,
 * layer separation. No AI is used.
 */

import { z } from 'zod';

/** Supported architecture patterns that the engine can detect. */
export const ArchitecturePatternSchema = z.enum([
  'mvc',
  'clean',
  'hexagonal',
  'ddd',
  'layered',
  'microservice',
  'modular',
  'monolith',
  'unknown',
]);

export type ArchitecturePattern = z.infer<typeof ArchitecturePatternSchema>;

/** A detected architectural layer (e.g., controllers, services, domain). */
export const ArchitectureLayerSchema = z.object({
  /** Layer name. */
  name: z.string(),

  /** Directories belonging to this layer. */
  directories: z.array(z.string()),

  /** File count in this layer. */
  fileCount: z.number().int().nonnegative(),

  /** Layer role in the architecture. */
  role: z.enum([
    'presentation',
    'application',
    'domain',
    'infrastructure',
    'shared',
    'config',
    'test',
    'unknown',
  ]),
});

export type ArchitectureLayer = z.infer<typeof ArchitectureLayerSchema>;

/** Evidence supporting a pattern detection. */
export const ArchitectureEvidenceSchema = z.object({
  /** The heuristic rule that produced this evidence. */
  rule: z.string(),

  /** Human-readable description. */
  description: z.string(),

  /** Specific file/directory paths that matched. */
  matchedPaths: z.array(z.string()),

  /** How much this evidence supports the detected pattern (0-1). */
  weight: z.number().min(0).max(1),
});

export type ArchitectureEvidence = z.infer<typeof ArchitectureEvidenceSchema>;

export const ArchitectureDNASchema = z.object({
  /** Unique identifier. */
  id: z.string(),

  /** The primary detected architecture pattern. */
  pattern: ArchitecturePatternSchema,

  /** Confidence score (0-1) for the primary pattern. */
  confidence: z.number().min(0).max(1),

  /** All detected patterns with their confidence scores. */
  detectedPatterns: z.array(
    z.object({
      pattern: ArchitecturePatternSchema,
      confidence: z.number().min(0).max(1),
    }),
  ),

  /** Detected architectural layers. */
  layers: z.array(ArchitectureLayerSchema),

  /** Evidence supporting the detection. */
  evidence: z.array(ArchitectureEvidenceSchema),

  /** When the architecture was last inferred. */
  detectedAt: z.number(),
});

export type ArchitectureDNA = z.infer<typeof ArchitectureDNASchema>;
