import {
  ImpactResultDataSchema,
  ImpactTargetDataSchema,
  type ImpactResultData,
  type ImpactTargetData,
  type ExtensionMessage,
} from '@project-dna/shared';

export interface ImpactState {
  readonly status: 'idle' | 'loading' | 'ready' | 'error' | 'cancelled';
  readonly requestId: number;
  readonly analysisVersion: number;
  readonly target: ImpactTargetData | null;
  readonly result: ImpactResultData | null;
  readonly error: string | null;
}

export const initialImpactState: ImpactState = {
  status: 'idle',
  requestId: 0,
  analysisVersion: 0,
  target: null,
  result: null,
  error: null,
};

export function restoreImpactState(candidate: unknown): ImpactState {
  if (!candidate || typeof candidate !== 'object') return initialImpactState;
  const value = (candidate as { impact?: unknown }).impact;
  if (!value || typeof value !== 'object') return initialImpactState;
  const state = value as Partial<ImpactState>;
  if (
    !['idle', 'loading', 'ready', 'error', 'cancelled'].includes(state.status ?? '') ||
    !Number.isSafeInteger(state.requestId) ||
    Number(state.requestId) < 0 ||
    !Number.isSafeInteger(state.analysisVersion) ||
    Number(state.analysisVersion) < 0
  )
    return initialImpactState;
  const target =
    state.target === null || state.target === undefined
      ? null
      : ImpactTargetDataSchema.safeParse(state.target);
  const result =
    state.result === null || state.result === undefined
      ? null
      : ImpactResultDataSchema.safeParse(state.result);
  if ((target !== null && !target.success) || (result !== null && !result.success)) {
    return initialImpactState;
  }
  if (
    (state.status === 'loading' && target === null) ||
    (state.status === 'ready' && result === null) ||
    (state.status === 'idle' && (target !== null || result !== null))
  ) {
    return initialImpactState;
  }
  return {
    status: state.status!,
    requestId: state.requestId!,
    analysisVersion: state.analysisVersion!,
    target: target === null ? null : target.data,
    result: result === null ? null : result.data,
    error: state.error ?? null,
  };
}

export type ImpactAction =
  | { type: 'select'; requestId: number; analysisVersion: number; target: ImpactTargetData }
  | { type: 'cancel'; requestId: number }
  | { type: 'message'; message: ExtensionMessage };

export function reduceImpactState(state: ImpactState, action: ImpactAction): ImpactState {
  if (action.type === 'select') {
    return {
      status: 'loading',
      requestId: action.requestId,
      analysisVersion: action.analysisVersion,
      target: action.target,
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
    message.type === 'analysisStarted' ||
    (message.type === 'analysisSnapshot' && message.version !== state.analysisVersion)
  ) {
    return { ...initialImpactState, requestId: state.requestId };
  }
  if (
    message.type !== 'impactResult' ||
    state.status !== 'loading' ||
    message.requestId !== state.requestId ||
    message.analysisVersion !== state.analysisVersion ||
    !sameTarget(message.target, state.target)
  )
    return state;
  if (!message.result)
    return {
      ...state,
      status: 'error',
      result: null,
      error: message.error ?? 'Impact analysis unavailable.',
    };
  return { ...state, status: 'ready', result: message.result, error: null };
}

function sameTarget(left: ImpactTargetData, right: ImpactTargetData | null): boolean {
  if (!right || left.kind !== right.kind) return false;
  return left.kind === 'file' && right.kind === 'file'
    ? left.path === right.path
    : left.kind === 'entity' && right.kind === 'entity' && left.id === right.id;
}
