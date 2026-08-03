/**
 * ISoftwareIntelligenceEngine — Contract for the reasoning layer (Stage 7).
 *
 * Takes synthesized DNA and produces actionable intelligence:
 * health scores, complexity profiles, risk assessments,
 * critical component identification, and narrative stories.
 *
 * Entirely deterministic. No AI. No ML. No probabilistic models.
 */

import type { Result } from '@project-dna/shared';
import type { DNAObject } from '../models/dna-object.js';
import type { DNAGraph } from '../models/dna-graph.js';
import type { RepositoryProfile } from '../models/repository-profile.js';
import type { ArchitectureDNA } from '../models/architecture-dna.js';
import type { KnowledgeNode } from '../models/knowledge-node.js';
import type { RiskNode } from '../models/risk-node.js';
import type { RepositoryHealth } from '../models/repository-health.js';
import type { ComplexityProfile } from '../models/complexity-profile.js';
import type { RiskAssessment } from '../models/risk-assessment.js';
import type { CriticalComponent } from '../models/critical-component.js';
import type { RepositoryStory } from '../models/repository-story.js';

/** All inputs needed by the Intelligence Engine. */
export interface IntelligenceInput {
  readonly entities: DNAObject[];
  readonly dnaGraph: DNAGraph;
  readonly profile: RepositoryProfile;
  readonly architecture: ArchitectureDNA;
  readonly knowledgeNodes: KnowledgeNode[];
  readonly risks: RiskNode[];
}

/** Complete output of the intelligence process. */
export interface IntelligenceOutput {
  readonly health: RepositoryHealth;
  readonly complexity: ComplexityProfile;
  readonly risks: RiskAssessment;
  readonly criticalComponents: CriticalComponent[];
  readonly story: RepositoryStory;
}

export interface ISoftwareIntelligenceEngine {
  /**
   * Compute intelligence from synthesized DNA.
   *
   * @param input - Synthesized DNA objects, graph, profile, and architecture.
   * @param signal - Optional cancellation signal.
   * @returns Health, complexity, risk, criticality, and narrative intelligence.
   */
  computeIntelligence(
    input: IntelligenceInput,
    signal?: AbortSignal,
  ): Promise<Result<IntelligenceOutput>>;
}
