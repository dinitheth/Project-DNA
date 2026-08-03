/**
 * DNADiff — The diff between two ProjectDNA snapshots.
 *
 * Captures what changed between two versions: added/removed entities,
 * health deltas, new/resolved risks, and graph topology changes.
 */

import { z } from 'zod';

export const EntityDiffSchema = z.object({
  /** DNAObject ID that changed. */
  entityId: z.string(),
  /** What changed. */
  changes: z.array(
    z.object({
      /** Field that changed. */
      field: z.string(),
      /** Previous value (serialized). */
      from: z.unknown(),
      /** New value (serialized). */
      to: z.unknown(),
    }),
  ),
});

export type EntityDiff = z.infer<typeof EntityDiffSchema>;

export const DNADiffSchema = z.object({
  /** Source version. */
  fromVersion: z.number().int().nonnegative(),

  /** Target version. */
  toVersion: z.number().int().nonnegative(),

  /** When this diff was computed. */
  timestamp: z.number(),

  // ── Entity changes ──
  /** New DNAObject IDs added. */
  addedEntities: z.array(z.string()),
  /** DNAObject IDs removed. */
  removedEntities: z.array(z.string()),
  /** Modified entities with specific field changes. */
  modifiedEntities: z.array(EntityDiffSchema),

  // ── Health changes ──
  /** Overall health delta (positive = improvement). */
  healthDelta: z.object({
    overall: z.number(),
    dimensions: z.record(z.string(), z.number()),
  }),

  // ── Risk changes ──
  /** New risks that appeared. */
  newRisks: z.array(z.string()),
  /** Risks that were resolved. */
  resolvedRisks: z.array(z.string()),

  // ── Graph topology changes ──
  /** Number of new edges added to the graph. */
  addedEdges: z.number().int().nonnegative(),
  /** Number of edges removed from the graph. */
  removedEdges: z.number().int().nonnegative(),
  /** New business domains detected. */
  newDomains: z.array(z.string()),
  /** Business domains that disappeared. */
  removedDomains: z.array(z.string()),

  /** Architectural significance score (0-1). High = major structural change. */
  architecturalSignificance: z.number().min(0).max(1),
});

export type DNADiff = z.infer<typeof DNADiffSchema>;
