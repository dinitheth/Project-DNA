// ─── Domain Models (existing) ──────────────────────────────────────
export { RepositoryDNASchema, createRepositoryId } from './repository-dna.js';
export type { RepositoryDNA } from './repository-dna.js';

export { ModuleDNASchema } from './module-dna.js';
export type { ModuleDNA } from './module-dna.js';

export { FileDNASchema } from './file-dna.js';
export type { FileDNA } from './file-dna.js';

export { ClassDNASchema } from './class-dna.js';
export type { ClassDNA } from './class-dna.js';

export { FunctionDNASchema } from './function-dna.js';
export type { FunctionDNA } from './function-dna.js';

export { DependencyDNASchema } from './dependency-dna.js';
export type { DependencyDNA } from './dependency-dna.js';

export {
  ArchitectureDNASchema,
  ArchitecturePatternSchema,
  ArchitectureLayerSchema,
  ArchitectureEvidenceSchema,
} from './architecture-dna.js';
export type {
  ArchitectureDNA,
  ArchitecturePattern,
  ArchitectureLayer,
  ArchitectureEvidence,
} from './architecture-dna.js';

export { KnowledgeNodeSchema, KnowledgeNodeTypeSchema } from './knowledge-node.js';
export type { KnowledgeNode, KnowledgeNodeType } from './knowledge-node.js';

export { RiskNodeSchema, RiskSeveritySchema, RiskTypeSchema } from './risk-node.js';
export type { RiskNode, RiskSeverity, RiskType } from './risk-node.js';

export { RepositoryGraph } from './repository-graph.js';
export type { GraphNodeAttributes, GraphEdgeAttributes } from './repository-graph.js';

// ─── New Domain Models (Layer 3/4) ─────────────────────────────────
export {
  DNAObjectSchema,
  DNAObjectKindSchema,
  ArchitectureRoleSchema,
  CriticalityLevelSchema,
} from './dna-object.js';
export type { DNAObject, DNAObjectKind, ArchitectureRole, CriticalityLevel } from './dna-object.js';

export { DNAGraph, createSemanticDnaGraph } from './dna-graph.js';
export type {
  DNAGraphNodeKind,
  DNAGraphNodeAttributes,
  DNAGraphEdgeKind,
  DNAGraphEdgeAttributes,
} from './dna-graph.js';

export { ProjectDNASchema, AnalysisConfigSchema, AnalysisCoverageSchema } from './project-dna.js';
export type { ProjectDNA, AnalysisConfig, AnalysisCoverage } from './project-dna.js';

export {
  RepositoryProfileSchema,
  ProjectTypeSchema,
  RepositorySizeSchema,
  LanguageBreakdownSchema,
  FrameworkDetectionSchema,
  MaturityIndicatorsSchema,
} from './repository-profile.js';
export type {
  RepositoryProfile,
  ProjectType,
  RepositorySize,
  LanguageBreakdown,
  FrameworkDetection,
  MaturityIndicators,
} from './repository-profile.js';

export {
  RepositoryHealthSchema,
  HealthTrendSchema,
  HealthDimensionsSchema,
  createRepositoryHealth,
} from './repository-health.js';
export type { RepositoryHealth, HealthTrend, HealthDimensions } from './repository-health.js';

export { BusinessDomainSchema } from './business-domain.js';
export type { BusinessDomain } from './business-domain.js';

export { CapabilitySchema, CapabilityCategorySchema } from './capability.js';
export type { Capability, CapabilityCategory } from './capability.js';

export { CriticalComponentSchema } from './critical-component.js';
export type { CriticalComponent } from './critical-component.js';

export {
  ComplexityProfileSchema,
  ComplexityDistributionSchema,
  createComplexityProfile,
} from './complexity-profile.js';
export type { ComplexityProfile, ComplexityDistribution } from './complexity-profile.js';

export {
  RiskAssessmentSchema,
  RISK_SEVERITY_WEIGHTS,
  calculateRiskExposureScore,
  compareRiskExposure,
  createRiskAssessment,
} from './risk-assessment.js';
export type { RiskAssessment } from './risk-assessment.js';

export {
  EvolutionSnapshotSchema,
  SnapshotTriggerSchema,
  createProjectDnaSnapshotHash,
  createProjectDnaSnapshotMetrics,
} from './evolution-snapshot.js';
export type { EvolutionSnapshot, SnapshotTrigger } from './evolution-snapshot.js';

export { DNADiffSchema, EntityDiffSchema } from './dna-diff.js';
export type { DNADiff, EntityDiff } from './dna-diff.js';

export { RepositoryStorySchema } from './repository-story.js';
export type { RepositoryStory } from './repository-story.js';

export {
  ImpactTargetSchema,
  ImpactOptionsSchema,
  ImpactRelationshipTypeSchema,
  ImpactRelationshipSchema,
  ImpactNodeSchema,
  ImpactPathSchema,
  ImpactEvidenceReasonSchema,
  ImpactEvidenceSchema,
  ImpactScoreComponentKindSchema,
  ImpactScoreComponentSchema,
  ImpactScoreComponentStatusSchema,
  ImpactScoreSchema,
  ImpactTruncationKindSchema,
  ImpactTruncationSchema,
  ImpactBoundsSchema,
  ImpactSemanticEffectsSchema,
  ImpactResultSchema,
  DEFAULT_IMPACT_BOUNDS,
  HARD_IMPACT_BOUNDS,
} from './impact.js';
export type {
  ImpactTarget,
  ImpactOptions,
  ImpactRelationship,
  ImpactNode,
  ImpactPath,
  ImpactEvidence,
  ImpactScoreComponent,
  ImpactScoreComponentStatus,
  ImpactScore,
  ImpactTruncation,
  ImpactBounds,
  ImpactSemanticEffects,
  ImpactResult,
} from './impact.js';
