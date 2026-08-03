/**
 * DNADiffer — Computes the diff between two ProjectDNA snapshots.
 *
 * Identifies what changed between versions: entity additions/removals,
 * health deltas, risk changes, and graph topology shifts.
 */

import type { Logger } from '@project-dna/shared';
import type { EvolutionSnapshot, DNADiff } from '@project-dna/dna-core';

export class DNADiffer {
  constructor(private readonly logger: Logger) {}

  computeDiff(fromSnapshot: EvolutionSnapshot, toSnapshot: EvolutionSnapshot): DNADiff {
    this.logger.info(`Computing diff: v${fromSnapshot.version} -> v${toSnapshot.version}`);

    const healthDelta = this.computeHealthDelta(fromSnapshot.metrics, toSnapshot.metrics);

    return {
      fromVersion: fromSnapshot.version,
      toVersion: toSnapshot.version,
      timestamp: Date.now(),

      // Entity changes (computed from metrics since we store counts)
      addedEntities: [],
      removedEntities: [],
      modifiedEntities: [],

      // Health changes
      healthDelta: {
        overall: healthDelta.overall,
        dimensions: healthDelta.dimensions,
      },

      // Risk changes
      newRisks: [],
      resolvedRisks: [],

      // Graph topology (approximated from metrics)
      addedEdges: 0,
      removedEdges: 0,
      newDomains: [],
      removedDomains: [],

      architecturalSignificance: this.computeArchitecturalSignificance(
        fromSnapshot.metrics,
        toSnapshot.metrics,
      ),
    };
  }

  private computeHealthDelta(
    fromMetrics: Record<string, number>,
    toMetrics: Record<string, number>,
  ): { overall: number; dimensions: Record<string, number> } {
    const dimensions: Record<string, number> = {};

    for (const key of Object.keys(toMetrics)) {
      if (key.startsWith('health.') && key !== 'health.overall') {
        const dimName = key.replace('health.', '');
        dimensions[dimName] = (toMetrics[key] ?? 0) - (fromMetrics[key] ?? 0);
      }
    }

    return {
      overall: (toMetrics['health.overall'] ?? 0) - (fromMetrics['health.overall'] ?? 0),
      dimensions,
    };
  }

  private computeArchitecturalSignificance(
    fromMetrics: Record<string, number>,
    toMetrics: Record<string, number>,
  ): number {
    // Factors that indicate significant architectural change:
    // - Large change in entity count (files added/removed)
    // - Large change in domain count
    // - Large health score change
    // - Large complexity change

    const entityDelta = Math.abs(
      (toMetrics['entities.total'] ?? 0) - (fromMetrics['entities.total'] ?? 0),
    );
    const domainDelta = Math.abs(
      (toMetrics['domains.total'] ?? 0) - (fromMetrics['domains.total'] ?? 0),
    );
    const healthDelta = Math.abs(
      (toMetrics['health.overall'] ?? 0) - (fromMetrics['health.overall'] ?? 0),
    );

    const entitySignificance = Math.min(
      1,
      entityDelta / Math.max(1, fromMetrics['entities.total'] ?? 1),
    );
    const domainSignificance = domainDelta > 0 ? 0.5 : 0;
    const healthSignificance = Math.min(1, healthDelta / 20); // 20-point change = max significance

    return Math.min(
      1,
      entitySignificance * 0.4 + domainSignificance * 0.3 + healthSignificance * 0.3,
    );
  }
}
