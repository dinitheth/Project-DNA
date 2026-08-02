/**
 * EvolutionEngine — Makes ProjectDNA alive.
 *
 * Implements IEvolutionEngine. Manages snapshots, computes diffs,
 * and provides historical data for trend analysis.
 *
 * Without this engine, every analysis is a disposable snapshot.
 * With it, the system remembers, compares, and tracks trends.
 */

import { Ok, Err } from '@project-dna/shared';
import type { Logger, Result } from '@project-dna/shared';
import type {
  IEvolutionEngine,
  ProjectDNA,
  EvolutionSnapshot,
  DNADiff,
} from '@project-dna/dna-core';
import { SnapshotCreator } from './snapshot/snapshot-creator.js';
import { DNADiffer } from './diff/dna-differ.js';

export class EvolutionEngine implements IEvolutionEngine {
  private readonly snapshotCreator: SnapshotCreator;
  private readonly differ: DNADiffer;
  private readonly snapshots: EvolutionSnapshot[] = [];

  constructor(private readonly logger: Logger) {
    this.snapshotCreator = new SnapshotCreator(logger);
    this.differ = new DNADiffer(logger);
  }

  async createSnapshot(
    dna: ProjectDNA,
    _signal?: AbortSignal,
  ): Promise<Result<EvolutionSnapshot>> {
    try {
      const trigger = this.snapshots.length === 0 ? 'manual' : 'incremental';
      const snapshot = this.snapshotCreator.create(dna, trigger);
      this.snapshots.push(snapshot);

      this.logger.info(`Evolution snapshot v${snapshot.version} stored (total: ${this.snapshots.length})`);
      return Ok(snapshot);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(`Failed to create snapshot: ${err.message}`);
      return Err(err);
    }
  }

  async computeDiff(
    fromVersion: number,
    toVersion: number,
  ): Promise<Result<DNADiff>> {
    try {
      const fromSnapshot = this.snapshots.find((s) => s.version === fromVersion);
      const toSnapshot = this.snapshots.find((s) => s.version === toVersion);

      if (!fromSnapshot) {
        return Err(new Error(`Snapshot v${fromVersion} not found`));
      }
      if (!toSnapshot) {
        return Err(new Error(`Snapshot v${toVersion} not found`));
      }

      const diff = this.differ.computeDiff(fromSnapshot, toSnapshot);
      return Ok(diff);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(`Failed to compute diff: ${err.message}`);
      return Err(err);
    }
  }

  async getHistory(limit?: number): Promise<Result<EvolutionSnapshot[]>> {
    try {
      const sorted = [...this.snapshots].sort((a, b) => b.version - a.version);
      const result = limit ? sorted.slice(0, limit) : sorted;
      return Ok(result);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      return Err(err);
    }
  }

  async getLatestSnapshot(): Promise<Result<EvolutionSnapshot | null>> {
    try {
      if (this.snapshots.length === 0) return Ok(null);
      const latest = this.snapshots.reduce((max, s) =>
        s.version > max.version ? s : max,
      );
      return Ok(latest);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      return Err(err);
    }
  }
}
