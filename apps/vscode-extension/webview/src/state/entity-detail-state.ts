import {
  EntityDetailDataSchema,
  type EntityDetailData,
  type ExtensionMessage,
} from '@project-dna/shared';

export interface EntityDetailState {
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  readonly requestId: number;
  readonly analysisVersion: number;
  readonly entityId: string | null;
  readonly entity: EntityDetailData | null;
  readonly error: string | null;
}

export const initialEntityDetailState: EntityDetailState = {
  status: 'idle',
  requestId: 0,
  analysisVersion: 0,
  entityId: null,
  entity: null,
  error: null,
};

export function restoreEntityDetailState(candidate: unknown): EntityDetailState {
  if (!candidate || typeof candidate !== 'object') return initialEntityDetailState;
  const state = (candidate as { entityDetail?: unknown }).entityDetail;
  if (!state || typeof state !== 'object') return initialEntityDetailState;
  const detail = state as Partial<EntityDetailState>;
  if (
    !['idle', 'loading', 'ready', 'error'].includes(detail.status ?? '') ||
    !Number.isSafeInteger(detail.requestId) ||
    Number(detail.requestId) < 0 ||
    !Number.isSafeInteger(detail.analysisVersion) ||
    Number(detail.analysisVersion) < 0 ||
    (detail.entityId !== null && typeof detail.entityId !== 'string')
  ) {
    return initialEntityDetailState;
  }
  const entity =
    detail.entity === null || detail.entity === undefined
      ? null
      : EntityDetailDataSchema.safeParse(detail.entity);
  if (entity !== null && !entity.success) return initialEntityDetailState;
  return {
    status: detail.status!,
    requestId: detail.requestId!,
    analysisVersion: detail.analysisVersion!,
    entityId: detail.entityId ?? null,
    entity: entity === null ? null : entity.data,
    error: detail.error ?? null,
  };
}

export type EntityDetailAction =
  | {
      readonly type: 'select';
      readonly requestId: number;
      readonly entityId: string;
      readonly analysisVersion: number;
    }
  | { readonly type: 'message'; readonly message: ExtensionMessage };

export function reduceEntityDetailState(
  state: EntityDetailState,
  action: EntityDetailAction,
): EntityDetailState {
  if (action.type === 'select') {
    return {
      status: 'loading',
      requestId: action.requestId,
      analysisVersion: action.analysisVersion,
      entityId: action.entityId,
      entity: null,
      error: null,
    };
  }
  const { message } = action;
  if (
    message.type === 'analysisStarted' ||
    (message.type === 'analysisSnapshot' && message.version !== state.analysisVersion)
  ) {
    return { ...initialEntityDetailState, requestId: state.requestId };
  }
  if (message.type !== 'entityDetail') return state;
  if (
    state.status !== 'loading' ||
    message.requestId !== state.requestId ||
    message.analysisVersion !== state.analysisVersion ||
    message.entityId !== state.entityId
  ) {
    return state;
  }
  return message.entity
    ? { ...state, status: 'ready', entity: message.entity, error: null }
    : { ...state, status: 'error', entity: null, error: message.error ?? 'Entity unavailable.' };
}
