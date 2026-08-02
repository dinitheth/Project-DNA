/**
 * IEvolutionEngine — Contract for versioning, diffing, and tracking over time.
 *
 * Makes ProjectDNA alive by remembering, comparing, and detecting trends.
 * Operates orthogonally to the main pipeline — it consumes
 * completed ProjectDNA instances and manages historical snapshots.
 */

import type { Result } from '@project-dna/shared';
import type { ProjectDNA } from '../models/project-dna.js';
import type { EvolutionSnapshot } from '../models/evolution-snapshot.js';
import type { DNADiff } from '../models/dna-diff.js';

export interface IEvolutionEngine {
  /**
   * Create a snapshot from the current ProjectDNA.
   * Determines whether to create a full or incremental snapshot
   * based on the architectural significance of changes.
   *
   * @param dna - The current ProjectDNA to snapshot.
   * @param signal - Optional cancellation signal.
   * @returns The created snapshot.
   */
  createSnapshot(dna: ProjectDNA, signal?: AbortSignal): Promise<Result<EvolutionSnapshot>>;

  /**
   * Compute the diff between two versions.
   *
   * @param fromVersion - Source version number.
   * @param toVersion - Target version number.
   * @returns The computed diff.
   */
  computeDiff(fromVersion: number, toVersion: number): Promise<Result<DNADiff>>;

  /**
   * Get historical snapshots, most recent first.
   *
   * @param limit - Maximum number of snapshots to return.
   * @returns Array of snapshots.
   */
  getHistory(limit?: number): Promise<Result<EvolutionSnapshot[]>>;

  /**
   * Get the most recent snapshot, or null if none exists.
   */
  getLatestSnapshot(): Promise<Result<EvolutionSnapshot | null>>;
}
