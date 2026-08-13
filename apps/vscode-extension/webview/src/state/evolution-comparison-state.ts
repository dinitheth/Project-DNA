import type { EvolutionComparisonData, ExtensionMessage } from '@project-dna/shared';

export interface EvolutionComparisonState {
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  readonly requestId: number;
  readonly analysisVersion: number;
  readonly fromVersion: number | null;
  readonly toVersion: number | null;
  readonly comparison: EvolutionComparisonData | null;
  readonly error: string | null;
}

export const initialEvolutionComparisonState: EvolutionComparisonState = {
  status: 'idle',
  requestId: 0,
  analysisVersion: 0,
  fromVersion: null,
  toVersion: null,
  comparison: null,
  error: null,
};

export function restoreEvolutionComparisonState(candidate: unknown): EvolutionComparisonState {
  if (!candidate || typeof candidate !== 'object') return initialEvolutionComparisonState;
  const state = (candidate as { evolutionComparison?: unknown }).evolutionComparison;
  if (!state || typeof state !== 'object') return initialEvolutionComparisonState;
  const comparison = state as Partial<EvolutionComparisonState>;
  if (
    !['idle', 'loading', 'ready', 'error'].includes(comparison.status ?? '') ||
    !Number.isSafeInteger(comparison.requestId) ||
    Number(comparison.requestId) < 0 ||
    !Number.isSafeInteger(comparison.analysisVersion) ||
    Number(comparison.analysisVersion) < 0 ||
    (comparison.fromVersion !== null && !Number.isSafeInteger(comparison.fromVersion)) ||
    (comparison.toVersion !== null && !Number.isSafeInteger(comparison.toVersion))
  ) {
    return initialEvolutionComparisonState;
  }
  return {
    status: comparison.status!,
    requestId: comparison.requestId!,
    analysisVersion: comparison.analysisVersion!,
    fromVersion: comparison.fromVersion ?? null,
    toVersion: comparison.toVersion ?? null,
    comparison: comparison.comparison ?? null,
    error: comparison.error ?? null,
  };
}

export function reduceEvolutionComparisonState(
  state: EvolutionComparisonState,
  action:
    | {
        type: 'select';
        requestId: number;
        analysisVersion: number;
        fromVersion: number;
        toVersion: number;
      }
    | { type: 'message'; message: ExtensionMessage },
): EvolutionComparisonState {
  if (action.type === 'select') {
    return {
      status: 'loading',
      requestId: action.requestId,
      analysisVersion: action.analysisVersion,
      fromVersion: action.fromVersion,
      toVersion: action.toVersion,
      comparison: null,
      error: null,
    };
  }
  const { message } = action;
  if (
    message.type === 'analysisStarted' ||
    (message.type === 'analysisSnapshot' && message.version !== state.analysisVersion)
  )
    return { ...initialEvolutionComparisonState, requestId: state.requestId };
  if (message.type !== 'evolutionComparison') return state;
  if (
    state.status !== 'loading' ||
    message.requestId !== state.requestId ||
    message.analysisVersion !== state.analysisVersion ||
    message.fromVersion !== state.fromVersion ||
    message.toVersion !== state.toVersion
  )
    return state;
  return message.comparison
    ? { ...state, status: 'ready', comparison: message.comparison, error: null }
    : {
        ...state,
        status: 'error',
        comparison: null,
        error: message.error ?? 'Comparison unavailable.',
      };
}
