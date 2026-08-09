import {
  Container,
  EventBus,
  TOKENS,
  createLogger,
  type DNAEventMap,
  type Logger,
} from '@project-dna/shared';
import {
  DNAOrchestrator,
  ProjectDNAService,
  type AnalysisPerformanceRecorder,
  type IArchitectureEngine,
  type IAstEngine,
  type IDNAEngine,
  type IDependencyEngine,
  type IEvolutionEngine,
  type IKnowledgeEngine,
  type IProjectDNAService,
  type IRepositoryScanner,
  type ISoftwareIntelligenceEngine,
  type IStoragePort,
} from '@project-dna/dna-core';
import { RepositoryScanner } from '@project-dna/repository-scanner';
import { AstEngine, type AstEngineOptions } from '@project-dna/ast-engine';
import { DependencyEngine } from '@project-dna/dependency-engine';
import { ArchitectureEngine } from '@project-dna/architecture-engine';
import { KnowledgeEngine } from '@project-dna/knowledge-engine';
import { DNAEngine } from '@project-dna/dna-engine';
import { SoftwareIntelligenceEngine } from '@project-dna/software-intelligence-engine';
import { EvolutionEngine } from '@project-dna/evolution-engine';
import { SqliteStorage } from '@project-dna/storage';

export interface ContainerOptions {
  readonly logger?: Logger;
  readonly storagePath?: string;
  readonly performanceRecorder?: AnalysisPerformanceRecorder;
  readonly astEngineOptions?: AstEngineOptions;
  readonly nativeBindingPath?: string;
}

export function createContainer(options: ContainerOptions | Logger = {}): Container {
  const resolved = isLogger(options) ? { logger: options } : options;
  const logger = resolved.logger ?? createLogger({ name: 'project-dna' });
  const storagePath = resolved.storagePath ?? ':memory:';
  const container = new Container();
  container.register(TOKENS.Logger, () => logger);
  container.register(TOKENS.EventBus, () => new EventBus<DNAEventMap>());
  container.register(
    TOKENS.StoragePort,
    (current) =>
      new SqliteStorage(storagePath, current.resolve<Logger>(TOKENS.Logger), {
        nativeBinding: resolved.nativeBindingPath,
      }),
  );
  container.register(
    TOKENS.RepositoryScanner,
    (current) => new RepositoryScanner({ logger: current.resolve<Logger>(TOKENS.Logger) }),
  );
  container.register(
    TOKENS.AstEngine,
    (current) => new AstEngine(current.resolve<Logger>(TOKENS.Logger), resolved.astEngineOptions),
  );
  container.register(
    TOKENS.DependencyEngine,
    (current) => new DependencyEngine(current.resolve<Logger>(TOKENS.Logger)),
  );
  container.register(
    TOKENS.ArchitectureEngine,
    (current) => new ArchitectureEngine(current.resolve<Logger>(TOKENS.Logger)),
  );
  container.register(
    TOKENS.KnowledgeEngine,
    (current) => new KnowledgeEngine(current.resolve<Logger>(TOKENS.Logger)),
  );
  container.register(
    TOKENS.DNAEngine,
    (current) => new DNAEngine(current.resolve<Logger>(TOKENS.Logger)),
  );
  container.register(
    TOKENS.IntelligenceEngine,
    (current) => new SoftwareIntelligenceEngine(current.resolve<Logger>(TOKENS.Logger)),
  );
  container.register(
    TOKENS.EvolutionEngine,
    (current) => new EvolutionEngine(current.resolve<Logger>(TOKENS.Logger)),
  );
  container.register(
    TOKENS.Orchestrator,
    (current) =>
      new DNAOrchestrator({
        scanner: current.resolve<IRepositoryScanner>(TOKENS.RepositoryScanner),
        astEngine: current.resolve<IAstEngine>(TOKENS.AstEngine),
        dependencyEngine: current.resolve<IDependencyEngine>(TOKENS.DependencyEngine),
        architectureEngine: current.resolve<IArchitectureEngine>(TOKENS.ArchitectureEngine),
        knowledgeEngine: current.resolve<IKnowledgeEngine>(TOKENS.KnowledgeEngine),
        eventBus: current.resolve<EventBus<DNAEventMap>>(TOKENS.EventBus),
        logger: current.resolve<Logger>(TOKENS.Logger),
        performanceRecorder: resolved.performanceRecorder,
      }),
  );
  container.register(
    TOKENS.ProjectDNAService,
    (current) =>
      new ProjectDNAService({
        orchestrator: current.resolve<DNAOrchestrator>(TOKENS.Orchestrator),
        dnaEngine: current.resolve<IDNAEngine>(TOKENS.DNAEngine),
        intelligenceEngine: current.resolve<ISoftwareIntelligenceEngine>(TOKENS.IntelligenceEngine),
        evolutionEngine: current.resolve<IEvolutionEngine>(TOKENS.EvolutionEngine),
        eventBus: current.resolve<EventBus<DNAEventMap>>(TOKENS.EventBus),
        logger: current.resolve<Logger>(TOKENS.Logger),
        storage: current.resolve<IStoragePort>(TOKENS.StoragePort),
        performanceRecorder: resolved.performanceRecorder,
      }),
  );

  container.resolve<IProjectDNAService>(TOKENS.ProjectDNAService);
  return container;
}

function isLogger(value: ContainerOptions | Logger): value is Logger {
  return 'info' in value && typeof value.info === 'function';
}
