/**
 * EvolutionSnapshot — A point-in-time capture of ProjectDNA state.
 *
 * Snapshots are created after each analysis and stored incrementally.
 * Full snapshots only after significant architectural changes.
 * Incremental snapshots store deltas anchored to Git commits.
 */

import { z } from 'zod';
import { createHash } from 'node:crypto';
import type { ProjectDNA } from './project-dna.js';
import { AnalysisStateViewSchema } from './analysis-state-view.js';

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

  /** Canonical deterministic analysis state used by Evolution and Impact. */
  analysisState: AnalysisStateViewSchema.optional(),
});

export type EvolutionSnapshot = z.infer<typeof EvolutionSnapshotSchema>;

/** Compute the deterministic content hash stored in an evolution snapshot. */
export function createProjectDnaSnapshotHash(dna: ProjectDNA): string {
  const hashContent = JSON.stringify({
    id: dna.id,
    version: dna.version,
    entityCount: dna.entityCount,
    moduleCount: dna.moduleCount,
    healthScore: dna.health.overallScore,
    architecture: dna.architecture.pattern,
  });
  return createHash('sha256').update(hashContent).digest('hex').slice(0, 16);
}

/** Extract the deterministic metric set stored in an evolution snapshot. */
export function createProjectDnaSnapshotMetrics(dna: ProjectDNA): Record<string, number> {
  return {
    'health.overall': dna.health.overallScore,
    'health.architecture': dna.health.dimensions.architectureHealth,
    'health.dependency': dna.health.dimensions.dependencyHealth,
    'health.complexity': dna.health.dimensions.complexityHealth,
    'health.knowledge': dna.health.dimensions.knowledgeHealth,
    'health.risk': dna.health.dimensions.riskHealth,
    'complexity.average': dna.complexity.averageComplexity,
    'complexity.max': dna.complexity.maxComplexity,
    'complexity.instability': dna.complexity.averageInstability,
    'risk.overall': dna.risks.overallRiskScore,
    'risk.total': dna.risks.totalRisks,
    'risk.critical': dna.risks.bySeverity.critical,
    'entities.total': dna.entityCount,
    'modules.total': dna.moduleCount,
    'domains.total': dna.domainCount,
    'capabilities.total': dna.capabilityCount,
    'knowledge.total': dna.knowledgeNodeCount,
    'critical.total': dna.criticalComponents.length,
    'duration.ms': dna.durationMs,
  };
}
