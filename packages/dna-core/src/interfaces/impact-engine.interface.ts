import type { Result } from '@project-dna/shared';
import type { ArchitectureDNA } from '../models/architecture-dna.js';
import type { BusinessDomain } from '../models/business-domain.js';
import type { Capability } from '../models/capability.js';
import type { CriticalComponent } from '../models/critical-component.js';
import type { DNAObject } from '../models/dna-object.js';
import type { ImpactOptions, ImpactResult, ImpactTarget } from '../models/impact.js';
import type { RepositoryGraph } from '../models/repository-graph.js';
import type { RiskNode } from '../models/risk-node.js';

/** Canonical semantic collections consumed by structural impact calculation. */
export interface ImpactSemanticInput {
  readonly entities?: readonly DNAObject[] | null;
  readonly domains?: readonly BusinessDomain[] | null;
  readonly capabilities?: readonly Capability[] | null;
  readonly criticalComponents?: readonly CriticalComponent[] | null;
  readonly risks?: readonly RiskNode[] | null;
  readonly architecture?: ArchitectureDNA | null;
}

/** Internal service-to-engine request. Graph objects never cross the public service API. */
export interface ImpactEngineInput {
  readonly repositoryId: string;
  readonly analysisVersion: number;
  readonly expectedAnalysisVersion?: number;
  readonly graph: RepositoryGraph;
  readonly semantic?: ImpactSemanticInput;
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
