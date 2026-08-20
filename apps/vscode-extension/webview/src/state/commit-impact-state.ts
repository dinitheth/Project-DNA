import {
  CommitImpactDataSchema,
  type CommitImpactData,
  type ExtensionMessage,
} from '@project-dna/shared';

export type CommitImpactStatus =
  'idle' | 'editing' | 'loading' | 'parent-selection' | 'ready' | 'error' | 'cancelled';

export interface CommitImpactState {
  readonly visible: boolean;
  readonly status: CommitImpactStatus;
  readonly requestId: number;
  readonly repositoryId: string | null;
  readonly commitSha: string | null;
  readonly selectedParentSha: string | null;
  readonly parentCommits: readonly string[];
  readonly result: CommitImpactData | null;
  readonly error: string | null;
}

export const initialCommitImpactState: CommitImpactState = {
  visible: false,
  status: 'idle',
  requestId: 0,
  repositoryId: null,
  commitSha: null,
  selectedParentSha: null,
  parentCommits: [],
  result: null,
  error: null,
};

export type CommitImpactAction =
  | { readonly type: 'open' }
  | { readonly type: 'close' }
  | {
      readonly type: 'request';
      readonly requestId: number;
      readonly commitSha: string;
      readonly selectedParentSha: string | null;
    }
  | { readonly type: 'cancel'; readonly requestId: number }
  | { readonly type: 'message'; readonly message: ExtensionMessage };

export function reduceCommitImpactState(
  state: CommitImpactState,
  action: CommitImpactAction,
): CommitImpactState {
  if (action.type === 'open') {
    return state.visible ? state : { ...state, visible: true, status: 'editing', error: null };
  }
  if (action.type === 'close') {
    return { ...initialCommitImpactState, requestId: state.requestId };
  }
  if (action.type === 'request') {
    return {
      visible: true,
      status: 'loading',
      requestId: action.requestId,
      repositoryId: state.repositoryId,
      commitSha: action.commitSha,
      selectedParentSha: action.selectedParentSha,
      parentCommits: state.commitSha === action.commitSha ? state.parentCommits : [],
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
  if (message.type === 'analysisUnavailable') {
    return { ...initialCommitImpactState, requestId: state.requestId };
  }
  if (
    message.type !== 'commitImpactResult' ||
    state.status !== 'loading' ||
    message.requestId !== state.requestId ||
    message.commitSha !== state.commitSha ||
    !matchesParentIdentity(state.selectedParentSha, message)
  ) {
    return state;
  }
  if (message.requiresParentSelection) {
    return {
      ...state,
      status: 'parent-selection',
      repositoryId: message.repositoryId,
      selectedParentSha: null,
      parentCommits: message.parentCommits,
      result: null,
      error: null,
    };
  }
  if (!message.result) {
    return {
      ...state,
      status: 'error',
      repositoryId: message.repositoryId,
      selectedParentSha: message.selectedParentSha,
      parentCommits: message.parentCommits,
      result: null,
      error: message.error ?? 'Commit impact is unavailable.',
    };
  }
  if (
    message.repositoryId === null ||
    message.result.repositoryId !== message.repositoryId ||
    message.result.commitSha !== message.commitSha ||
    message.result.selectedParentSha !== message.selectedParentSha
  ) {
    return state;
  }
  return {
    ...state,
    status: 'ready',
    repositoryId: message.repositoryId,
    selectedParentSha: message.selectedParentSha,
    parentCommits: message.parentCommits,
    result: message.result,
    error: null,
  };
}

export function restoreCommitImpactState(candidate: unknown): CommitImpactState {
  if (!candidate || typeof candidate !== 'object') return initialCommitImpactState;
  const value = (candidate as { commitImpact?: unknown }).commitImpact;
  if (!value || typeof value !== 'object') return initialCommitImpactState;
  const state = value as Partial<CommitImpactState>;
  if (
    typeof state.visible !== 'boolean' ||
    !isStatus(state.status) ||
    !Number.isSafeInteger(state.requestId) ||
    Number(state.requestId) < 0 ||
    !isNullableString(state.repositoryId) ||
    !isNullableSha(state.commitSha) ||
    !isNullableSha(state.selectedParentSha) ||
    !Array.isArray(state.parentCommits) ||
    !state.parentCommits.every(isSha) ||
    !isNullableString(state.error)
  ) {
    return initialCommitImpactState;
  }
  const result =
    state.result === null || state.result === undefined
      ? null
      : CommitImpactDataSchema.safeParse(state.result);
  if (result !== null && !result.success) return initialCommitImpactState;
  if (
    (state.status === 'ready' && result === null) ||
    (state.status === 'loading' && result !== null) ||
    (state.status === 'parent-selection' && state.parentCommits.length < 2) ||
    (!state.visible && state.status !== 'idle')
  ) {
    return initialCommitImpactState;
  }
  return {
    visible: state.visible,
    status: state.status,
    requestId: state.requestId!,
    repositoryId: state.repositoryId ?? null,
    commitSha: state.commitSha ?? null,
    selectedParentSha: state.selectedParentSha ?? null,
    parentCommits: [...state.parentCommits],
    result: result === null ? null : result.data,
    error: state.error ?? null,
  };
}

export function shouldFocusCommitImpactStatus(
  previous: CommitImpactStatus,
  current: CommitImpactStatus,
): boolean {
  return (
    previous === 'loading' && ['parent-selection', 'ready', 'error', 'cancelled'].includes(current)
  );
}

function matchesParentIdentity(
  requestedParent: string | null,
  message: Extract<ExtensionMessage, { type: 'commitImpactResult' }>,
): boolean {
  if (requestedParent !== null) return message.selectedParentSha === requestedParent;
  if (message.requiresParentSelection) return message.selectedParentSha === null;
  return message.parentCommits.length <= 1;
}

function isStatus(value: unknown): value is CommitImpactStatus {
  return ['idle', 'editing', 'loading', 'parent-selection', 'ready', 'error', 'cancelled'].includes(
    String(value),
  );
}

function isSha(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{40}$/u.test(value);
}

function isNullableSha(value: unknown): value is string | null | undefined {
  return value === null || value === undefined || isSha(value);
}

function isNullableString(value: unknown): value is string | null | undefined {
  return value === null || value === undefined || typeof value === 'string';
}
