/**
 * RiskNode — A detected risk or code smell in the repository.
 *
 * Risks are deterministic observations based on measurable thresholds
 * (e.g., cyclomatic complexity > 20, circular dependencies, files > 500 LOC).
 */

import { z } from 'zod';

export const RiskSeveritySchema = z.enum(['info', 'low', 'medium', 'high', 'critical']);
export type RiskSeverity = z.infer<typeof RiskSeveritySchema>;

export const RiskTypeSchema = z.enum([
  'circular-dependency',
  'god-class',
  'high-complexity',
  'orphan-file',
  'unstable-module',
  'large-file',
  'deep-nesting',
  'excessive-imports',
  'missing-types',
  'barrel-explosion',
]);
export type RiskType = z.infer<typeof RiskTypeSchema>;

export const RiskNodeSchema = z.object({
  /** Unique identifier. */
  id: z.string(),

  /** Type of risk detected. */
  type: RiskTypeSchema,

  /** Severity level. */
  severity: RiskSeveritySchema,

  /** Entities (file paths, class names) affected by this risk. */
  affectedEntities: z.array(z.string()),

  /** Human-readable description of the risk. */
  description: z.string(),

  /** Measured value that triggered the risk (e.g., complexity=35). */
  measuredValue: z.number().optional(),

  /** Threshold that was exceeded. */
  threshold: z.number().optional(),

  /** Suggested action to mitigate the risk. */
  suggestion: z.string().optional(),

  /** When this risk was detected. */
  detectedAt: z.number(),
});

export type RiskNode = z.infer<typeof RiskNodeSchema>;
