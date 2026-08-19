import {
  WorkingTreeImpactDataSchema,
  type ExtensionMessage,
  type WorkingTreeImpactData,
} from '@project-dna/shared';

export type WorkingTreeImpactStatus = 'idle' | 'loading' | 'ready' | 'error' | 'cancelled';

export interface WorkingTreeImpactState {
  readonly status: WorkingTreeImpactStatus;
  readonly requestId: number;
  readonly analysisVersion: number;
  readonly result: WorkingTreeImpactData | null;
  readonly error: string | null;
}

export const initialWorkingTreeImpactState: WorkingTreeImpactState = {
  status: 'idle',
  requestId: 0,
  analysisVersion: 0,
  result: null,
  error: null,
};

export function restoreWorkingTreeImpactState(candidate: unknown): WorkingTreeImpactState {
  if (!candidate || typeof candidate !== 'object') return initialWorkingTreeImpactState;
  const value = (candidate as { workingTreeImpact?: unknown }).workingTreeImpact;
  if (!value || typeof value !== 'object') return initialWorkingTreeImpactState;
  const state = value as Partial<WorkingTreeImpactState>;
  if (
    !['idle', 'loading', 'ready', 'error', 'cancelled'].includes(state.status ?? '') ||
    !Number.isSafeInteger(state.requestId) ||
    Number(state.requestId) < 0 ||
    !Number.isSafeInteger(state.analysisVersion) ||
    Number(state.analysisVersion) < 0
  ) {
    return initialWorkingTreeImpactState;
  }
  const result =
    state.result === null || state.result === undefined
      ? null
      : WorkingTreeImpactDataSchema.safeParse(state.result);
  if (result !== null && !result.success) return initialWorkingTreeImpactState;
  if (state.error !== null && state.error !== undefined && typeof state.error !== 'string') {
    return initialWorkingTreeImpactState;
  }
  if (
    (state.status === 'ready' && result === null) ||
    (state.status === 'idle' && result !== null) ||
    (state.status === 'loading' && result !== null)
  ) {
    return initialWorkingTreeImpactState;
  }
  return {
    status: state.status!,
    requestId: state.requestId!,
    analysisVersion: state.analysisVersion!,
    result: result === null ? null : result.data,
    error: state.error ?? null,
  };
}

export type WorkingTreeImpactAction =
  | { type: 'request'; requestId: number; analysisVersion: number }
  | { type: 'cancel'; requestId: number }
  | { type: 'message'; message: ExtensionMessage };

export function reduceWorkingTreeImpactState(
  state: WorkingTreeImpactState,
  action: WorkingTreeImpactAction,
): WorkingTreeImpactState {
  if (action.type === 'request') {
    return {
      status: 'loading',
      requestId: action.requestId,
      analysisVersion: action.analysisVersion,
      result: null,
      error: null,
    };
  }
  if (action.type === 'cancel') {
    return state.status === 'loading' && action.requestId === state.requestId
      ? { ...state, status: 'cancelled', result: null, error: null }
      : state;
  }
  const { message } = action;
  if (
    message.type === 'analysisUnavailable' ||
    message.type === 'analysisStarted' ||
    (message.type === 'analysisSnapshot' && message.version !== state.analysisVersion)
  ) {
    return { ...initialWorkingTreeImpactState, requestId: state.requestId };
  }
  if (
    message.type !== 'workingTreeImpactResult' ||
    state.status !== 'loading' ||
    message.requestId !== state.requestId ||
    message.analysisVersion !== state.analysisVersion
  ) {
    return state;
  }
  if (!message.result) {
    return {
      ...state,
      status: 'error',
      result: null,
      error: message.error ?? 'Working-tree impact is unavailable.',
    };
  }
  return { ...state, status: 'ready', result: message.result, error: null };
}

export function shouldFocusWorkingTreeStatus(
  previous: WorkingTreeImpactStatus,
  current: WorkingTreeImpactStatus,
): boolean {
  return (
    previous === 'loading' &&
    (current === 'ready' || current === 'error' || current === 'cancelled')
  );
}
