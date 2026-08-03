/**
 * DNA-specific event definitions.
 *
 * Every cross-engine event is defined here with its payload type.
 * The orchestrator subscribes to these events to drive the analysis pipeline.
 * Individual engines emit events upon completion or failure.
 *
 * UPDATED: Added synthesis, intelligence, and evolution events
 * for the full 7-stage pipeline.
 */

import type { FilePath } from '../types/common.js';

// ─── Layer 2: Analysis Event Payloads ───────────────────────────────

export interface ScanStartedPayload {
  readonly rootPath: FilePath;
  readonly timestamp: number;
}

export interface ScanCompletePayload {
  readonly rootPath: FilePath;
  readonly fileCount: number;
  readonly languageCount: number;
  readonly durationMs: number;
}

export interface AstParseStartedPayload {
  readonly totalFiles: number;
}

export interface AstParseProgressPayload {
  readonly filePath: FilePath;
  readonly current: number;
  readonly total: number;
}

export interface AstParseCompletePayload {
  readonly filesProcessed: number;
  readonly durationMs: number;
}

export interface DependenciesResolvedPayload {
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly circularDependencyCount: number;
  readonly durationMs: number;
}

export interface ArchitectureInferredPayload {
  readonly pattern: string;
  readonly confidence: number;
  readonly durationMs: number;
}

export interface KnowledgeGeneratedPayload {
  readonly nodeCount: number;
  readonly durationMs: number;
}

// ─── Layer 3: Synthesis Event Payloads (NEW) ────────────────────────

export interface DNASynthesisStartedPayload {
  readonly entityCount: number;
  readonly timestamp: number;
}

export interface DNASynthesisProgressPayload {
  readonly current: number;
  readonly total: number;
  readonly currentEntity: string;
}

export interface DNAGraphBuiltPayload {
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly durationMs: number;
}

export interface DNASynthesisCompletePayload {
  readonly entityCount: number;
  readonly domainCount: number;
  readonly capabilityCount: number;
  readonly durationMs: number;
}

// ─── Layer 4: Intelligence Event Payloads (NEW) ─────────────────────

export interface IntelligenceStartedPayload {
  readonly timestamp: number;
}

export interface HealthComputedPayload {
  readonly overallScore: number;
  readonly durationMs: number;
}

export interface CriticalityComputedPayload {
  readonly criticalCount: number;
  readonly highCount: number;
  readonly durationMs: number;
}

export interface RiskAssessmentCompletePayload {
  readonly totalRisks: number;
  readonly criticalRisks: number;
  readonly durationMs: number;
}

export interface StoryGeneratedPayload {
  readonly locale: string;
  readonly durationMs: number;
}

export interface IntelligenceCompletePayload {
  readonly healthScore: number;
  readonly riskScore: number;
  readonly durationMs: number;
}

// ─── Aggregate & Evolution Event Payloads (NEW) ─────────────────────

export interface ProjectDNAReadyPayload {
  readonly version: number;
  readonly entityCount: number;
  readonly healthScore: number;
  readonly durationMs: number;
}

export interface EvolutionSnapshotCreatedPayload {
  readonly snapshotId: string;
  readonly version: number;
  readonly isFullSnapshot: boolean;
}

export interface EvolutionDiffComputedPayload {
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly addedEntities: number;
  readonly removedEntities: number;
  readonly healthDelta: number;
}

// ─── Pipeline Event Payloads ────────────────────────────────────────

export interface AnalysisErrorPayload {
  readonly stage: string;
  readonly error: Error;
  readonly filePath?: FilePath;
}

export interface AnalysisProgressPayload {
  readonly stage: string;
  readonly message: string;
  readonly percent: number;
  readonly startedAt: number;
  readonly detail?: string;
}

// ─── Event Map ──────────────────────────────────────────────────────

/** Complete map of DNA event names to their payload types. */
export interface DNAEventMap {
  // Layer 2 — Analysis
  ScanStarted: ScanStartedPayload;
  ScanComplete: ScanCompletePayload;
  AstParseStarted: AstParseStartedPayload;
  AstParseProgress: AstParseProgressPayload;
  AstParseComplete: AstParseCompletePayload;
  DependenciesResolved: DependenciesResolvedPayload;
  ArchitectureInferred: ArchitectureInferredPayload;
  KnowledgeGenerated: KnowledgeGeneratedPayload;

  // Layer 3 — Synthesis (NEW)
  DNASynthesisStarted: DNASynthesisStartedPayload;
  DNASynthesisProgress: DNASynthesisProgressPayload;
  DNAGraphBuilt: DNAGraphBuiltPayload;
  DNASynthesisComplete: DNASynthesisCompletePayload;

  // Layer 4 — Intelligence (NEW)
  IntelligenceStarted: IntelligenceStartedPayload;
  HealthComputed: HealthComputedPayload;
  CriticalityComputed: CriticalityComputedPayload;
  RiskAssessmentComplete: RiskAssessmentCompletePayload;
  StoryGenerated: StoryGeneratedPayload;
  IntelligenceComplete: IntelligenceCompletePayload;

  // Aggregate (NEW)
  ProjectDNAReady: ProjectDNAReadyPayload;

  // Evolution (NEW)
  EvolutionSnapshotCreated: EvolutionSnapshotCreatedPayload;
  EvolutionDiffComputed: EvolutionDiffComputedPayload;

  // Pipeline
  AnalysisError: AnalysisErrorPayload;
  AnalysisProgress: AnalysisProgressPayload;
}

/** Event name constants for use without string literals. */
export const DNAEventNames = {
  // Layer 2
  ScanStarted: 'ScanStarted',
  ScanComplete: 'ScanComplete',
  AstParseStarted: 'AstParseStarted',
  AstParseProgress: 'AstParseProgress',
  AstParseComplete: 'AstParseComplete',
  DependenciesResolved: 'DependenciesResolved',
  ArchitectureInferred: 'ArchitectureInferred',
  KnowledgeGenerated: 'KnowledgeGenerated',

  // Layer 3
  DNASynthesisStarted: 'DNASynthesisStarted',
  DNASynthesisProgress: 'DNASynthesisProgress',
  DNAGraphBuilt: 'DNAGraphBuilt',
  DNASynthesisComplete: 'DNASynthesisComplete',

  // Layer 4
  IntelligenceStarted: 'IntelligenceStarted',
  HealthComputed: 'HealthComputed',
  CriticalityComputed: 'CriticalityComputed',
  RiskAssessmentComplete: 'RiskAssessmentComplete',
  StoryGenerated: 'StoryGenerated',
  IntelligenceComplete: 'IntelligenceComplete',

  // Aggregate
  ProjectDNAReady: 'ProjectDNAReady',

  // Evolution
  EvolutionSnapshotCreated: 'EvolutionSnapshotCreated',
  EvolutionDiffComputed: 'EvolutionDiffComputed',

  // Pipeline
  AnalysisError: 'AnalysisError',
  AnalysisProgress: 'AnalysisProgress',
} as const satisfies Record<keyof DNAEventMap, keyof DNAEventMap>;
