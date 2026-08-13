import type {
  ArchitectureData,
  DependencyData,
  EvolutionData,
  ExtensionMessage,
  KnowledgeData,
  RepositoryData,
  SemanticGraphData,
} from '@project-dna/shared';

export type AppStatus = 'loading' | 'empty' | 'analyzing' | 'ready' | 'error';

export interface ProgressState {
  readonly message: string;
  readonly percent: number;
}

export interface AnalysisState {
  readonly status: AppStatus;
  readonly workspaceRoot: string | null;
  readonly progress: ProgressState | null;
  readonly error: string | null;
  readonly repository: RepositoryData | null;
  readonly architecture: ArchitectureData | null;
  readonly dependencies: DependencyData | null;
  readonly knowledge: KnowledgeData | null;
  readonly semanticGraph: SemanticGraphData | null;
  readonly evolution: EvolutionData | null;
  readonly latestVersion: number;
}

export const initialAnalysisState: AnalysisState = {
  status: 'loading',
  workspaceRoot: null,
  progress: null,
  error: null,
  repository: null,
  architecture: null,
  dependencies: null,
  knowledge: null,
  semanticGraph: null,
  evolution: null,
  latestVersion: 0,
};

export function reduceAnalysisState(
  state: AnalysisState,
  message: ExtensionMessage,
): AnalysisState {
  switch (message.type) {
    case 'analysisUnavailable':
      return emptyState('empty', message.rootPath);
    case 'analysisStarted':
      return state.workspaceRoot === message.rootPath && state.repository
        ? {
            ...state,
            status: 'analyzing',
            progress: { message: 'Starting repository analysis...', percent: 0 },
            error: null,
          }
        : {
            ...emptyState('analyzing', message.rootPath),
            progress: { message: 'Starting repository analysis...', percent: 0 },
          };
    case 'analysisProgress':
      return state.status === 'analyzing'
        ? {
            ...state,
            progress: { message: message.message, percent: message.percent },
          }
        : state;
    case 'analysisError':
      if (state.repository) {
        return { ...state, status: 'ready', progress: null, error: message.message };
      }
      return {
        ...emptyState('error', state.workspaceRoot),
        error: message.message,
        latestVersion: state.latestVersion,
      };
    case 'analysisSnapshot':
      if (message.version !== message.data.repository.version) return state;
      if (
        message.version <= state.latestVersion ||
        (state.workspaceRoot !== null && message.data.repository.rootPath !== state.workspaceRoot)
      ) {
        return state;
      }
      return {
        status: 'ready',
        workspaceRoot: message.data.repository.rootPath,
        progress: null,
        error: null,
        repository: message.data.repository,
        architecture: message.data.architecture,
        dependencies: message.data.dependencies,
        knowledge: message.data.knowledge,
        semanticGraph: message.data.semanticGraph,
        evolution: message.data.evolution,
        latestVersion: message.version,
      };
    case 'analysisComplete':
      return state.status === 'analyzing' && state.repository
        ? { ...state, status: 'ready', progress: null }
        : state;
    case 'repositoryData':
    case 'architectureData':
    case 'dependencyData':
    case 'knowledgeData':
    case 'themeChanged':
    case 'navigateTo':
      return state;
  }
}

function emptyState(status: AppStatus, workspaceRoot: string | null): AnalysisState {
  return { ...initialAnalysisState, status, workspaceRoot };
}
