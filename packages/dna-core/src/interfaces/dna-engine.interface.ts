/**
 * IDNAEngine — Contract for the synthesis layer (Stage 6).
 *
 * Takes raw outputs from all five analysis engines and fuses them
 * into a unified software identity: enriched entities, semantic graph,
 * repository profile, business domains, and capabilities.
 */

import type { Result } from '@project-dna/shared';
import type { RepositoryDNA } from '../models/repository-dna.js';
import type { FileDNA } from '../models/file-dna.js';
import type { RepositoryGraph } from '../models/repository-graph.js';
import type { ArchitectureDNA } from '../models/architecture-dna.js';
import type { KnowledgeNode } from '../models/knowledge-node.js';
import type { RiskNode } from '../models/risk-node.js';
import type { DNAObject } from '../models/dna-object.js';
import type { DNAGraph } from '../models/dna-graph.js';
import type { RepositoryProfile } from '../models/repository-profile.js';
import type { BusinessDomain } from '../models/business-domain.js';
import type { Capability } from '../models/capability.js';

/** All analysis outputs needed by the DNA Engine. */
export interface SynthesisInput {
  readonly repository: RepositoryDNA;
  readonly files: FileDNA[];
  readonly dependencyGraph: RepositoryGraph;
  readonly architecture: ArchitectureDNA;
  readonly knowledgeNodes: KnowledgeNode[];
  readonly risks: RiskNode[];
}

/** Complete output of the DNA synthesis process. */
export interface SynthesisOutput {
  readonly entities: DNAObject[];
  readonly dnaGraph: DNAGraph;
  readonly profile: RepositoryProfile;
  readonly domains: BusinessDomain[];
  readonly capabilities: Capability[];
}

export interface IDNAEngine {
  /**
   * Synthesize all analysis outputs into unified DNA.
   *
   * @param input - All raw analysis outputs.
   * @param signal - Optional cancellation signal.
   * @returns Synthesized DNA objects, graph, profile, domains, and capabilities.
   */
  synthesize(input: SynthesisInput, signal?: AbortSignal): Promise<Result<SynthesisOutput>>;
}
