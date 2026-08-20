/**
 * IProjectDNAService — The public API for Project DNA.
 *
 * DESIGN DECISION (C1 fix): Composed from focused sub-interfaces.
 * Each sub-interface has a single responsibility. Consumers depend ONLY
 * on the narrowest sub-interface they need.
 *
 * DESIGN DECISION (C5 fix): All async lifecycle methods accept AbortSignal.
 *
 * Nothing bypasses this API. The VS Code extension, future CLI,
 * and future AI layer all consume IProjectDNAService (or its sub-interfaces).
 */

import type { Result } from '@project-dna/shared';
import type { ProjectDNA } from '../models/project-dna.js';
import type { ArchitectureDNA } from '../models/architecture-dna.js';
import type { RepositoryHealth } from '../models/repository-health.js';
import type { RepositoryProfile } from '../models/repository-profile.js';
import type { RepositoryStory } from '../models/repository-story.js';
import type { RiskAssessment } from '../models/risk-assessment.js';
import type { RiskNode } from '../models/risk-node.js';
import type { CriticalComponent } from '../models/critical-component.js';
import type { BusinessDomain } from '../models/business-domain.js';
import type { Capability } from '../models/capability.js';
import type { KnowledgeNode } from '../models/knowledge-node.js';
import type { DNAObject, DNAObjectKind, CriticalityLevel } from '../models/dna-object.js';
import type { RepositoryGraph } from '../models/repository-graph.js';
import type { DNAGraph } from '../models/dna-graph.js';
import type { EvolutionSnapshot } from '../models/evolution-snapshot.js';
import type { DNADiff } from '../models/dna-diff.js';
import type { PipelineProgress } from '../orchestrator/pipeline.js';
import type { ImpactOptions, ImpactResult, ImpactTarget } from '../models/impact.js';
import type {
  WorkingTreeImpactOptions,
  WorkingTreeImpactResult,
} from '../models/working-tree-impact.js';
import type { IProjectDNACommitImpact } from './commit-impact.interface.js';
import type { IProjectDNAPullRequestImpact } from './pull-request-impact.interface.js';

// ─── Entity Filter ──────────────────────────────────────────────────

/** Filter for querying DNAObjects. */
export interface EntityFilter {
  /** Filter by business domain. */
  domain?: string;
  /** Filter by architecture layer. */
  layer?: string;
  /** Filter by criticality level. */
  criticality?: CriticalityLevel;
  /** Filter by entity kind. */
  kind?: DNAObjectKind;
  /** Maximum results. */
  limit?: number;
  /** Offset for pagination. */
  offset?: number;
}

// ─── Sub-Interfaces ─────────────────────────────────────────────────

/**
 * Lifecycle operations: analyze, refresh, get current state.
 * Consumer: Commands, CLI.
 */
export interface IProjectDNAAnalyzer {
  /** Restore the latest persisted analysis for a repository, if one exists. */
  restore(rootPath: string): Promise<Result<ProjectDNA | null>>;
  /** Run the complete analysis pipeline and produce ProjectDNA. */
  analyze(rootPath: string, signal?: AbortSignal): Promise<Result<ProjectDNA>>;
  /** Re-analyze incrementally (only changed files). */
  refresh(signal?: AbortSignal): Promise<Result<ProjectDNA>>;
  /** Get the most recent ProjectDNA without re-analyzing. */
  getCurrent(): Result<ProjectDNA | null>;
  /** Dispose all resources (storage, event bus, graph memory). */
  dispose(): Promise<void>;
}

/**
 * Read-only queries against the current ProjectDNA.
 * Consumer: UI views, webview panels.
 */
export interface IProjectDNAQuery {
  // Synchronous (always loaded in the aggregate)
  getArchitecture(): ArchitectureDNA;
  getHealth(): RepositoryHealth;
  getIdentity(): RepositoryProfile;
  getStory(): RepositoryStory;
  getRisks(): RiskAssessment;
  getCriticalComponents(): CriticalComponent[];

  // Lazy-loaded collections (NOT embedded in ProjectDNA aggregate)
  getDomains(): Promise<Result<BusinessDomain[]>>;
  getCapabilities(): Promise<Result<Capability[]>>;
  getKnowledge(limit?: number): Promise<Result<KnowledgeNode[]>>;
  /** Complete deterministic risk observations for the current analysis version. */
  getRiskNodes(): Promise<Result<RiskNode[]>>;
  getEntities(filter?: EntityFilter): Promise<Result<DNAObject[]>>;
  getEntity(id: string): Promise<Result<DNAObject | null>>;

  // Graph queries (loaded from storage on demand)
  getDependencyGraph(): Promise<Result<RepositoryGraph>>;
  getDNAGraph(): Promise<Result<DNAGraph>>;
}

/**
 * Evolution queries — versioning, diffing, historical tracking.
 * Consumer: Evolution panel, trend views.
 */
export interface IProjectDNAEvolution {
  getHistory(limit?: number): Promise<Result<EvolutionSnapshot[]>>;
  getDiff(fromVersion: number, toVersion: number): Promise<Result<DNADiff>>;
  getLatestSnapshot(): Promise<Result<EvolutionSnapshot | null>>;
}

/**
 * Event subscription for pipeline progress and completion.
 * Consumer: Progress bars, status indicators.
 */
export interface IProjectDNAEvents {
  onProgress(listener: (progress: PipelineProgress) => void): () => void;
  onReady(listener: (dna: ProjectDNA) => void): () => void;
}

/** Version-consistent structural and semantic impact queries. */
export interface IProjectDNAImpact {
  getImpact(
    target: ImpactTarget,
    options?: ImpactOptions,
    signal?: AbortSignal,
  ): Promise<Result<ImpactResult>>;
}

export interface IProjectDNAWorkingTreeImpact {
  getWorkingTreeImpact(
    options?: WorkingTreeImpactOptions,
    signal?: AbortSignal,
  ): Promise<Result<WorkingTreeImpactResult>>;
}

// ─── Composed Service ───────────────────────────────────────────────

/**
 * The composed public API.
 *
 * Consumers should depend on the narrowest sub-interface they need:
 * - Commands that trigger analysis → IProjectDNAAnalyzer
 * - UI views reading data → IProjectDNAQuery
 * - Evolution views → IProjectDNAEvolution
 * - Progress bars → IProjectDNAEvents
 */
export interface IProjectDNAService
  extends
    IProjectDNAAnalyzer,
    IProjectDNAQuery,
    IProjectDNAEvolution,
    IProjectDNAEvents,
    IProjectDNAImpact,
    IProjectDNAWorkingTreeImpact,
    IProjectDNACommitImpact,
    IProjectDNAPullRequestImpact {}
