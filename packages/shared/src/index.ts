// ─── Dependency Injection ──────────────────────────────────────────
export { Container } from './di/container.js';
export type { Lifetime, Registration } from './di/container.js';
export { TOKENS } from './di/tokens.js';

// ─── Event Bus ─────────────────────────────────────────────────────
export { EventBus } from './events/event-bus.js';
export type {
  DNAEventMap,
  RepositoryFileChange,
  RepositoryFileChangeKind,
  RepositoryFilesChangedPayload,
  RepositoryWatcherInvalidatedPayload,
} from './events/dna-events.js';
export { DNAEventNames } from './events/dna-events.js';

// ─── Result Type ───────────────────────────────────────────────────
export { Ok, Err, isOk, isErr } from './result/result.js';
export type { Result } from './result/result.js';

// ─── Logger ────────────────────────────────────────────────────────
export { createLogger, createSilentLogger } from './logger/logger.js';
export type { Logger } from './logger/logger.js';

// ─── Protocol ──────────────────────────────────────────────────────
export type {
  ArchitectureData,
  CommitAnalysisChangeSetData,
  CommitChangedFileData,
  CommitImpactData,
  CommitImpactEntryData,
  DependencyData,
  EntityDetailData,
  EvolutionComparisonData,
  EvolutionData,
  ExtensionMessage,
  ImpactResultData,
  ImpactTargetData,
  KnowledgeData,
  MessageEnvelope,
  PullRequestImpactData,
  PullRequestImpactEntryData,
  RepositoryData,
  SemanticGraphData,
  SidebarRoute,
  WebviewMessage,
  WorkspaceRelativePath,
  WorkingTreeChangedPathData,
  WorkingTreeImpactData,
  WorkingTreeImpactEntryData,
  WorkingTreeResolvedTargetData,
  WorkingTreeUnresolvedPathData,
} from './protocol/messages.js';
export {
  ArchitectureDataSchema,
  CommitAnalysisChangeSetDataSchema,
  CommitChangedFileDataSchema,
  CommitImpactDataSchema,
  CommitImpactEntryDataSchema,
  DependencyDataSchema,
  EntityDetailDataSchema,
  EvolutionComparisonDataSchema,
  EvolutionDataSchema,
  ExtensionMessageSchema,
  ImpactResultDataSchema,
  ImpactTargetDataSchema,
  KnowledgeDataSchema,
  PullRequestImpactDataSchema,
  PullRequestImpactEntryDataSchema,
  RepositoryDataSchema,
  SemanticGraphDataSchema,
  SidebarRouteSchema,
  WebviewMessageSchema,
  WorkspaceRelativePathSchema,
  WorkingTreeChangedPathDataSchema,
  WorkingTreeImpactDataSchema,
  WorkingTreeImpactEntryDataSchema,
  WorkingTreeResolvedTargetDataSchema,
  WorkingTreeUnresolvedPathDataSchema,
} from './protocol/messages.js';

// ─── Constants ─────────────────────────────────────────────────────
export {
  SUPPORTED_LANGUAGES,
  DEFAULT_IGNORE_PATTERNS,
  FILE_SIZE_LIMIT_BYTES,
  EXTENSION_ID,
  COMMAND_IDS,
  VIEW_IDS,
} from './constants.js';

// ─── Common Types ──────────────────────────────────────────────────
export type {
  FilePath,
  RelativePath,
  Hash,
  Timestamp,
  LanguageId,
  Disposable,
} from './types/common.js';
