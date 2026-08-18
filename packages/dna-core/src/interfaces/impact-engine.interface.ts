import type { Result } from '@project-dna/shared';
import type { AnalysisStateView } from '../models/analysis-state-view.js';
import type { ArchitectureDNA } from '../models/architecture-dna.js';
import type { BusinessDomain } from '../models/business-domain.js';
import type { Capability } from '../models/capability.js';
import type { CriticalComponent } from '../models/critical-component.js';
import type { DNAObject } from '../models/dna-object.js';
import type { ImpactOptions, ImpactResult, ImpactTarget } from '../models/impact.js';
import type { RiskNode } from '../models/risk-node.js';

/** Semantic input helper retained for fixtures and callers constructing a state view. */
export interface ImpactSemanticInput {
  readonly entities?: readonly DNAObject[] | null;
  readonly domains?: readonly BusinessDomain[] | null;
  readonly capabilities?: readonly Capability[] | null;
  readonly criticalComponents?: readonly CriticalComponent[] | null;
  readonly risks?: readonly RiskNode[] | null;
  readonly architecture?: ArchitectureDNA | null;
}

/** Internal service-to-engine request using the canonical immutable analysis state. */
export interface ImpactEngineInput {
  readonly repositoryId: string;
  readonly analysisVersion: number;
  readonly expectedAnalysisVersion?: number;
  readonly state: AnalysisStateView;
}

/** Narrow dependency port used by ProjectDNAService composition. */
export interface IImpactEngine {
  getImpact(
    input: ImpactEngineInput,
    target: ImpactTarget,
    options?: Partial<ImpactOptions>,
    signal?: AbortSignal,
  ): Result<ImpactResult>;
}
