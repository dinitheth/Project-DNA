/**
 * SnapshotCreator — Creates EvolutionSnapshots from ProjectDNA.
 *
 * Determines whether to create a full or incremental snapshot
 * based on the architectural significance of changes.
 * Extracts key metrics for fast trending without loading the full DNA.
 */

import type { Logger } from '@project-dna/shared';
import {
  createProjectDnaSnapshotHash,
  createProjectDnaSnapshotMetrics,
  type ProjectDNA,
  type EvolutionSnapshot,
  type SnapshotTrigger,
  type AnalysisStateView,
  type AnalysisSourceProvenance,
} from '@project-dna/dna-core';

export class SnapshotCreator {
  private nextVersion = 1;
  private lastSnapshotId: string | null = null;

  constructor(private readonly logger: Logger) {}

  restore(snapshots: readonly EvolutionSnapshot[]): void {
    const latest = snapshots.reduce<EvolutionSnapshot | null>(
      (current, snapshot) => (!current || snapshot.version > current.version ? snapshot : current),
      null,
    );
    this.nextVersion = (latest?.version ?? 0) + 1;
    this.lastSnapshotId = latest?.id ?? null;
  }

  create(
    dna: ProjectDNA,
    trigger: SnapshotTrigger = 'manual',
    analysisState?: AnalysisStateView,
    sourceProvenance?: AnalysisSourceProvenance,
  ): EvolutionSnapshot {
    this.logger.info(`Creating evolution snapshot v${this.nextVersion}...`);

    const snapshotId = this.generateSnapshotId(dna);
    const metrics = createProjectDnaSnapshotMetrics(dna);
    const hash = createProjectDnaSnapshotHash(dna);

    const snapshot: EvolutionSnapshot = {
      id: snapshotId,
      version: this.nextVersion,
      timestamp: Date.now(),
      trigger,
      projectDnaHash: hash,
      gitCommitHash: null, // Would be populated by git integration
      metrics,
      parentSnapshotId: this.lastSnapshotId,
      isFullSnapshot: this.shouldCreateFullSnapshot(),
      projectDnaRef: `snapshot:${snapshotId}`,
      ...(analysisState ? { analysisState } : {}),
      ...(sourceProvenance ? { sourceProvenance } : {}),
    };

    this.lastSnapshotId = snapshotId;
    this.nextVersion++;

    this.logger.info(
      `Snapshot v${snapshot.version} created (${snapshot.isFullSnapshot ? 'full' : 'incremental'})`,
    );
    return snapshot;
  }

  private generateSnapshotId(dna: ProjectDNA): string {
    const timestamp = Date.now().toString(36);
    const version = this.nextVersion.toString().padStart(4, '0');
    return `snap-${dna.id.slice(0, 8)}-v${version}-${timestamp}`;
  }

  private shouldCreateFullSnapshot(): boolean {
    // Create a full snapshot every 10 versions, or if this is the first snapshot
    return this.nextVersion === 1 || this.nextVersion % 10 === 0;
  }
}
