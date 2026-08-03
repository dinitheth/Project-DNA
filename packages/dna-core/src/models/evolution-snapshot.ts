/**
 * EvolutionSnapshot — A point-in-time capture of ProjectDNA state.
 *
 * Snapshots are created after each analysis and stored incrementally.
 * Full snapshots only after significant architectural changes.
 * Incremental snapshots store deltas anchored to Git commits.
 */

import { z } from 'zod';

export const SnapshotTriggerSchema = z.enum([
  'manual',
  'incremental',
  'scheduled',
  'architectural-change',
]);
export type SnapshotTrigger = z.infer<typeof SnapshotTriggerSchema>;

export const EvolutionSnapshotSchema = z.object({
  /** Unique snapshot identifier. */
  id: z.string(),

  /** Monotonically increasing version number. */
  version: z.number().int().nonnegative(),

  /** When this snapshot was created. */
  timestamp: z.number(),

  /** What triggered this snapshot. */
  trigger: SnapshotTriggerSchema,

  /** Content-addressable hash of the ProjectDNA at this point. */
  projectDnaHash: z.string(),

  /** Git commit hash at the time of snapshot (null if not in a git repo). */
  gitCommitHash: z.string().nullable(),

  /** Flattened metric values for fast trending. */
  metrics: z.record(z.string(), z.number()),

  /** Previous snapshot ID (linked list for traversal). */
  parentSnapshotId: z.string().nullable(),

  /** Whether this is a full snapshot or an incremental delta. */
  isFullSnapshot: z.boolean(),

  /** Storage key for the full ProjectDNA data (if full snapshot). */
  projectDnaRef: z.string().nullable(),
});

export type EvolutionSnapshot = z.infer<typeof EvolutionSnapshotSchema>;
