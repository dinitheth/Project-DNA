import {
  EvolutionComparisonDataSchema,
  type EvolutionComparisonData,
  type ExtensionMessage,
} from '@project-dna/shared';

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
  const restored = state as Partial<EvolutionComparisonState>;
  if (
    !['idle', 'loading', 'ready', 'error'].includes(restored.status ?? '') ||
    !Number.isSafeInteger(restored.requestId) ||
    Number(restored.requestId) < 0 ||
    !Number.isSafeInteger(restored.analysisVersion) ||
    Number(restored.analysisVersion) < 0 ||
    (restored.fromVersion !== null && !Number.isSafeInteger(restored.fromVersion)) ||
    (restored.toVersion !== null && !Number.isSafeInteger(restored.toVersion))
  ) {
    return initialEvolutionComparisonState;
  }
  const comparisonData = stateValue(restored.comparison);
  if (comparisonData === false) return initialEvolutionComparisonState;
  return {
    status: restored.status!,
    requestId: restored.requestId!,
    analysisVersion: restored.analysisVersion!,
    fromVersion: restored.fromVersion ?? null,
    toVersion: restored.toVersion ?? null,
    comparison: comparisonData,
    error: restored.error ?? null,
  };
}

function stateValue(value: unknown): EvolutionComparisonData | null | false {
  if (value === null || value === undefined) return null;
  const parsed = EvolutionComparisonDataSchema.safeParse(value);
  return parsed.success ? parsed.data : false;
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
