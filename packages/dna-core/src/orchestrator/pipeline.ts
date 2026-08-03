/**
 * AnalysisPipeline — Defines the stages of the DNA analysis pipeline.
 *
 * Provides a typed enum of stages and progress tracking.
 * The orchestrator advances through these stages sequentially.
 *
 * UPDATED: Added synthesis, intelligence, and evolution stages
 * for the full 7-stage pipeline.
 */

/** All possible pipeline stages in order. */
export enum PipelineStage {
  Idle = 'idle',

  // Layer 2 — Analysis (existing)
  Scanning = 'scanning',
  Parsing = 'parsing',
  ResolvingDependencies = 'resolving-dependencies',
  InferringArchitecture = 'inferring-architecture',
  GeneratingKnowledge = 'generating-knowledge',

  // Layer 3 — Synthesis (NEW)
  SynthesizingDNA = 'synthesizing-dna',
  BuildingDNAGraph = 'building-dna-graph',

  // Layer 4 — Intelligence (NEW)
  ComputingIntelligence = 'computing-intelligence',
  ComputingEvolution = 'computing-evolution',

  // Terminal
  Complete = 'complete',
  Failed = 'failed',
}

/** Progress state for the pipeline. */
export interface PipelineProgress {
  /** Current stage. */
  stage: PipelineStage;
  /** Human-readable message for UI display. */
  message: string;
  /** Overall progress percentage (0-100). */
  percent: number;
  /** When this stage started. */
  startedAt: number;
  /** Stage-specific sub-progress (e.g., "42/150 files parsed"). */
  detail?: string;
}

/** Maps each stage to its approximate percentage weight in the total pipeline. */
export const STAGE_WEIGHTS: Record<PipelineStage, { start: number; end: number }> = {
  [PipelineStage.Idle]: { start: 0, end: 0 },
  [PipelineStage.Scanning]: { start: 0, end: 8 },
  [PipelineStage.Parsing]: { start: 8, end: 45 },
  [PipelineStage.ResolvingDependencies]: { start: 45, end: 55 },
  [PipelineStage.InferringArchitecture]: { start: 55, end: 62 },
  [PipelineStage.GeneratingKnowledge]: { start: 62, end: 70 },
  [PipelineStage.SynthesizingDNA]: { start: 70, end: 80 },
  [PipelineStage.BuildingDNAGraph]: { start: 80, end: 85 },
  [PipelineStage.ComputingIntelligence]: { start: 85, end: 95 },
  [PipelineStage.ComputingEvolution]: { start: 95, end: 100 },
  [PipelineStage.Complete]: { start: 100, end: 100 },
  [PipelineStage.Failed]: { start: 0, end: 0 },
};

/**
 * Calculate the overall pipeline percentage from a stage and its internal progress.
 *
 * @param stage - Current pipeline stage.
 * @param stageProgress - Progress within the current stage (0-1).
 * @returns Overall percentage (0-100).
 */
export function calculateOverallProgress(stage: PipelineStage, stageProgress: number = 0): number {
  const weight = STAGE_WEIGHTS[stage];
  return Math.round(
    weight.start + (weight.end - weight.start) * Math.min(1, Math.max(0, stageProgress)),
  );
}
