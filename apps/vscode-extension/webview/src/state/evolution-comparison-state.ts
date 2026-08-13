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
