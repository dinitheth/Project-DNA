// ─── Existing Engine Interfaces ────────────────────────────────────
export type {
  IncrementalScanRequest,
  IRepositoryScanner,
  RepositoryManifestEntry,
  RepositoryScanResult,
  ScannedFile,
} from './scanner.interface.js';
export type { IAstEngine, FileInput, ParseResult } from './ast-engine.interface.js';
export type {
  IDependencyEngine,
  CircularDependency,
  IncrementalDependencyRequest,
} from './dependency-engine.interface.js';
export type { IArchitectureEngine } from './architecture-engine.interface.js';
export type {
  IKnowledgeEngine,
  IncrementalKnowledgeRequest,
  KnowledgeResult,
} from './knowledge-engine.interface.js';
export { StorageConflictError } from './storage.interface.js';
export type {
  IStoragePort,
  IStorageInspectionPort,
  ITransactionalStoragePort,
  StorageRecordEvidence,
  StorageBatch,
  StorageMutation,
  StoragePrecondition,
} from './storage.interface.js';

// ─── New Engine Interfaces (Layer 3/4) ─────────────────────────────
export type {
  IDNAEngine,
  IncrementalSynthesisRequest,
  SynthesisInput,
  SynthesisOutput,
} from './dna-engine.interface.js';
export type {
  ISoftwareIntelligenceEngine,
  IntelligenceInput,
  IntelligenceOutput,
} from './intelligence-engine.interface.js';
export type { IEvolutionEngine } from './evolution-engine.interface.js';
export type { IWorkingTreeChangeSetProvider } from './working-tree-impact.interface.js';
export type { IProjectDNACommitImpact } from './commit-impact.interface.js';
export type {
  IImpactEngine,
  ImpactEngineInput,
  ImpactSemanticInput,
} from './impact-engine.interface.js';

// ─── Public API ────────────────────────────────────────────────────
export type {
  IProjectDNAService,
  IProjectDNAAnalyzer,
  IProjectDNAQuery,
  IProjectDNAEvolution,
  IProjectDNAEvents,
  IProjectDNAImpact,
  IProjectDNAWorkingTreeImpact,
  EntityFilter,
} from './project-dna-service.interface.js';
