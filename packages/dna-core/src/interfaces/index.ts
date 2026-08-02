// ─── Existing Engine Interfaces ────────────────────────────────────
export type { IRepositoryScanner } from './scanner.interface.js';
export type { IAstEngine, FileInput, ParseResult } from './ast-engine.interface.js';
export type { IDependencyEngine, CircularDependency } from './dependency-engine.interface.js';
export type { IArchitectureEngine } from './architecture-engine.interface.js';
export type { IKnowledgeEngine, KnowledgeResult } from './knowledge-engine.interface.js';
export type { IStoragePort } from './storage.interface.js';

// ─── New Engine Interfaces (Layer 3/4) ─────────────────────────────
export type { IDNAEngine, SynthesisInput, SynthesisOutput } from './dna-engine.interface.js';
export type { ISoftwareIntelligenceEngine, IntelligenceInput, IntelligenceOutput } from './intelligence-engine.interface.js';
export type { IEvolutionEngine } from './evolution-engine.interface.js';

// ─── Public API ────────────────────────────────────────────────────
export type {
  IProjectDNAService,
  IProjectDNAAnalyzer,
  IProjectDNAQuery,
  IProjectDNAEvolution,
  IProjectDNAEvents,
  EntityFilter,
} from './project-dna-service.interface.js';
