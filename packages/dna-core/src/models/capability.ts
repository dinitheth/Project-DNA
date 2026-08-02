/**
 * Capability — What the software CAN DO.
 *
 * Capabilities are inferred functional abilities derived from
 * detected frameworks, patterns, and module analysis.
 * Example: "REST API serving", "OAuth authentication", "SQL database access".
 */

import { z } from 'zod';

export const CapabilityCategorySchema = z.enum([
  'api',
  'authentication',
  'authorization',
  'caching',
  'database',
  'file-system',
  'logging',
  'messaging',
  'monitoring',
  'networking',
  'scheduling',
  'search',
  'storage',
  'testing',
  'ui',
  'other',
]);

export type CapabilityCategory = z.infer<typeof CapabilityCategorySchema>;

export const CapabilitySchema = z.object({
  /** Unique identifier. */
  id: z.string(),

  /** Human-readable capability name. */
  name: z.string(),

  /** Category of capability. */
  category: CapabilityCategorySchema,

  /** Description of what this capability provides. */
  description: z.string(),

  /** Confidence in the detection (0-1). */
  confidence: z.number().min(0).max(1),

  /** Evidence supporting this capability detection. */
  evidence: z.array(z.object({
    /** Type of evidence. */
    type: z.enum(['framework', 'pattern', 'import', 'config', 'naming']),
    /** What was detected. */
    indicator: z.string(),
    /** Where it was detected. */
    location: z.string(),
  })),

  /** DNAObject IDs that implement this capability. */
  implementedBy: z.array(z.string()),

  /** When this capability was detected. */
  detectedAt: z.number(),
});

export type Capability = z.infer<typeof CapabilitySchema>;
