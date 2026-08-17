// ─── Domain Models ─────────────────────────────────────────────────
export * from './models/index.js';

// ─── Engine Interfaces ─────────────────────────────────────────────
export * from './interfaces/index.js';

// ─── Shared Graph Primitives ───────────────────────────────────────
export { compareOrdinalStrings, traverseDependencyGraph } from './graph/dependency-traversal.js';
export type {
  DependencyTraversalDirection,
  DependencyTraversalNode,
  DependencyTraversalOptions,
  DependencyTraversalRequest,
  DependencyTraversalResult,
} from './graph/dependency-traversal.js';

// ─── Orchestrator ──────────────────────────────────────────────────
export { DNAOrchestrator } from './orchestrator/dna-orchestrator.js';
export type {
  AnalysisResult,
  IncrementalAnalysisRequest,
  OrchestratorDependencies,
} from './orchestrator/dna-orchestrator.js';
export { PipelineStage, calculateOverallProgress, STAGE_WEIGHTS } from './orchestrator/pipeline.js';
export type { PipelineProgress } from './orchestrator/pipeline.js';

// Performance instrumentation
export {
  AnalysisPerformanceStages,
  AnalysisPerformanceTracker,
} from './performance/analysis-performance.js';
export type {
  AnalysisMemoryUsage,
  AnalysisPerformanceMeasurement,
  AnalysisPerformanceRecorder,
  AnalysisPerformanceReport,
  AnalysisPerformanceStage,
  AnalysisPerformanceTrackerOptions,
} from './performance/analysis-performance.js';

// Public service implementation
export { ProjectDNAService } from './service/project-dna-service.js';
export type { ProjectDNAServiceDependencies } from './service/project-dna-service.js';
