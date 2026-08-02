/**
 * CriticalComponent — A high-importance entity in the repository.
 *
 * Critical components are identified via multi-factor scoring:
 * graph centrality + fan-in/fan-out + complexity + file size.
 * These are the entities where a bug has the highest blast radius.
 */

import { z } from 'zod';

export const CriticalityLevelSchema = z.enum(['critical', 'high', 'medium', 'low']);
export type CriticalityLevel = z.infer<typeof CriticalityLevelSchema>;

export const CriticalComponentSchema = z.object({
  /** Unique identifier. */
  id: z.string(),

  /** DNAObject ID of the critical entity. */
  entityId: z.string(),

  /** Name of the entity. */
  name: z.string(),

  /** File path. */
  path: z.string(),

  /** Criticality level. */
  criticality: CriticalityLevelSchema,

  /** Overall criticality score (0-1). */
  score: z.number().min(0).max(1),

  /** Individual factor scores that contribute to criticality. */
  factors: z.object({
    /** Graph centrality score (0-1). */
    centrality: z.number().min(0).max(1),
    /** Fan-in (number of dependents, normalized). */
    fanIn: z.number().min(0).max(1),
    /** Fan-out (number of dependencies, normalized). */
    fanOut: z.number().min(0).max(1),
    /** Cyclomatic complexity (normalized). */
    complexity: z.number().min(0).max(1),
    /** File size (normalized). */
    size: z.number().min(0).max(1),
  }),

  /** Why this component is critical (human-readable). */
  reason: z.string(),

  /** Risk IDs associated with this component. */
  associatedRiskIds: z.array(z.string()),

  /** When this was identified. */
  identifiedAt: z.number(),
});

export type CriticalComponent = z.infer<typeof CriticalComponentSchema>;
