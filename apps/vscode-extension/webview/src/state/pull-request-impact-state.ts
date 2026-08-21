import {
  PullRequestImpactDataSchema,
  type ExtensionMessage,
  type PullRequestImpactData,
} from '@project-dna/shared';

export type PullRequestImpactStatus = 'idle' | 'editing' | 'loading' | 'ready' | 'error' | 'cancelled';

export interface PullRequestImpactState {
  readonly visible: boolean;
  readonly status: PullRequestImpactStatus;
  readonly requestId: number;
  readonly baseSha: string | null;
  readonly headSha: string | null;
  readonly mergeBaseSha: string | null;
  readonly result: PullRequestImpactData | null;
  readonly error: string | null;
}

export const initialPullRequestImpactState: PullRequestImpactState = {
  visible: false,
  status: 'idle',
  requestId: 0,
  baseSha: null,
  headSha: null,
  mergeBaseSha: null,
  result: null,
  error: null,
};

export type PullRequestImpactAction =
  | { readonly type: 'open' }
  | { readonly type: 'close' }
  | { readonly type: 'request'; readonly requestId: number; readonly baseSha: string; readonly headSha: string }
  | { readonly type: 'cancel'; readonly requestId: number }
  | { readonly type: 'message'; readonly message: ExtensionMessage };

export function reducePullRequestImpactState(
  state: PullRequestImpactState,
  action: PullRequestImpactAction,
): PullRequestImpactState {
  if (action.type === 'open') return state.visible ? state : { ...state, visible: true, status: 'editing' };
  if (action.type === 'close') return { ...initialPullRequestImpactState, requestId: state.requestId };
  if (action.type === 'request') {
    return { visible: true, status: 'loading', requestId: action.requestId, baseSha: action.baseSha, headSha: action.headSha, mergeBaseSha: null, result: null, error: null };
  }
  if (action.type === 'cancel') {
    return state.status === 'loading' && state.requestId === action.requestId
      ? { ...state, status: 'cancelled', result: null, error: null }
      : state;
  }
  const { message } = action;
  if (message.type === 'analysisUnavailable') return { ...initialPullRequestImpactState, requestId: state.requestId };
  if (
    message.type !== 'pullRequestImpactResult' ||
    state.status !== 'loading' ||
    message.requestId !== state.requestId ||
    message.baseSha !== state.baseSha ||
    message.headSha !== state.headSha
  ) return state;
  if (!message.result) {
    return { ...state, status: 'error', mergeBaseSha: message.mergeBaseSha, error: message.error ?? 'PR impact is unavailable.' };
  }
  const parsed = PullRequestImpactDataSchema.safeParse(message.result);
  if (!parsed.success || parsed.data.baseCommitSha !== state.baseSha || parsed.data.headCommitSha !== state.headSha || parsed.data.mergeBaseSha !== message.mergeBaseSha) return state;
  return { ...state, status: 'ready', mergeBaseSha: message.mergeBaseSha, result: parsed.data, error: null };
}

export function restorePullRequestImpactState(candidate: unknown): PullRequestImpactState {
  if (!candidate || typeof candidate !== 'object') return initialPullRequestImpactState;
  const value = (candidate as { pullRequestImpact?: unknown }).pullRequestImpact;
  if (!value || typeof value !== 'object') return initialPullRequestImpactState;
  const state = value as Partial<PullRequestImpactState>;
  if (!isSafeRequestId(state.requestId) || typeof state.visible !== 'boolean' || !isStatus(state.status) || !isNullableSha(state.baseSha) || !isNullableSha(state.headSha) || !isNullableSha(state.mergeBaseSha) || (state.result !== null && state.result !== undefined && !PullRequestImpactDataSchema.safeParse(state.result).success)) return initialPullRequestImpactState;
  if (state.status === 'ready' && !state.result) return initialPullRequestImpactState;
  if (state.status === 'loading' && state.result) return initialPullRequestImpactState;
  if (!state.visible && state.status !== 'idle') return initialPullRequestImpactState;
  return { visible: state.visible, status: state.status, requestId: state.requestId!, baseSha: state.baseSha ?? null, headSha: state.headSha ?? null, mergeBaseSha: state.mergeBaseSha ?? null, result: state.result ? PullRequestImpactDataSchema.parse(state.result) : null, error: typeof state.error === 'string' ? state.error : null };
}

function isSafeRequestId(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) >= 0; }
function isNullableSha(value: unknown): value is string | null | undefined { return value === null || value === undefined || (typeof value === 'string' && /^[0-9a-f]{40}$/u.test(value)); }
function isStatus(value: unknown): value is PullRequestImpactStatus { return ['idle', 'editing', 'loading', 'ready', 'error', 'cancelled'].includes(String(value)); }
