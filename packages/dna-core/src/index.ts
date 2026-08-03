// ─── Domain Models ─────────────────────────────────────────────────
export * from './models/index.js';

// ─── Engine Interfaces ─────────────────────────────────────────────
export * from './interfaces/index.js';

// ─── Orchestrator ──────────────────────────────────────────────────
export { DNAOrchestrator } from './orchestrator/dna-orchestrator.js';
export type { AnalysisResult, OrchestratorDependencies } from './orchestrator/dna-orchestrator.js';
export { PipelineStage, calculateOverallProgress, STAGE_WEIGHTS } from './orchestrator/pipeline.js';
export type { PipelineProgress } from './orchestrator/pipeline.js';

// Public service implementation
export { ProjectDNAService } from './service/project-dna-service.js';
export type { ProjectDNAServiceDependencies } from './service/project-dna-service.js';
