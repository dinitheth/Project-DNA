/**
 * SnapshotCreator — Creates EvolutionSnapshots from ProjectDNA.
 *
 * Determines whether to create a full or incremental snapshot
 * based on the architectural significance of changes.
 * Extracts key metrics for fast trending without loading the full DNA.
 */

import type { Logger } from '@project-dna/shared';
import type { ProjectDNA, EvolutionSnapshot, SnapshotTrigger } from '@project-dna/dna-core';
import { createHash } from 'node:crypto';

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

  create(dna: ProjectDNA, trigger: SnapshotTrigger = 'manual'): EvolutionSnapshot {
    this.logger.info(`Creating evolution snapshot v${this.nextVersion}...`);

    const snapshotId = this.generateSnapshotId(dna);
    const metrics = this.extractMetrics(dna);
    const hash = this.computeHash(dna);

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
    };

    this.lastSnapshotId = snapshotId;
    this.nextVersion++;

    this.logger.info(`Snapshot v${snapshot.version} created (${snapshot.isFullSnapshot ? 'full' : 'incremental'})`);
    return snapshot;
  }

  private extractMetrics(dna: ProjectDNA): Record<string, number> {
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

  private computeHash(dna: ProjectDNA): string {
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
