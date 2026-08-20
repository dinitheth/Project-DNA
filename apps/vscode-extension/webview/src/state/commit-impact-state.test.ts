import { describe, expect, it } from 'vitest';
import { ExtensionMessageSchema } from '@project-dna/shared';
import {
  initialCommitImpactState,
  reduceCommitImpactState,
  restoreCommitImpactState,
  shouldFocusCommitImpactStatus,
} from './commit-impact-state.js';

describe('commit impact state', () => {
  it('accepts only the latest commit and selected-parent identity', () => {
    const first = request(1, 'a'.repeat(40), null);
    const second = reduceCommitImpactState(first, {
      type: 'request',
      requestId: 2,
      commitSha: 'b'.repeat(40),
      selectedParentSha: 'c'.repeat(40),
    });
    expect(reduceCommitImpactState(second, { type: 'message', message: response(1, 'a') })).toBe(
      second,
    );
    expect(
      reduceCommitImpactState(second, {
        type: 'message',
        message: response(2, 'b', { selectedParentSha: 'd'.repeat(40) }),
      }),
    ).toBe(second);
  });

  it('enters explicit merge parent selection and accepts the selected parent request', () => {
    const commitSha = 'a'.repeat(40);
    const parents = ['b'.repeat(40), 'c'.repeat(40)];
    const loading = request(1, commitSha, null);
    const selection = reduceCommitImpactState(loading, {
      type: 'message',
      message: response(1, 'a', { parents, requiresParentSelection: true }),
    });
    expect(selection).toMatchObject({
      status: 'parent-selection',
      parentCommits: parents,
      selectedParentSha: null,
    });
    const selected = reduceCommitImpactState(selection, {
      type: 'request',
      requestId: 2,
      commitSha,
      selectedParentSha: parents[1]!,
    });
    expect(selected.status).toBe('loading');
  });

  it('suppresses late results after cancellation and clears only on workspace unavailability', () => {
    const loading = request(1, 'a'.repeat(40), null);
    const cancelled = reduceCommitImpactState(loading, { type: 'cancel', requestId: 1 });
    expect(reduceCommitImpactState(cancelled, { type: 'message', message: response(1, 'a') })).toBe(
      cancelled,
    );
    const analysisStarted = ExtensionMessageSchema.parse({
      type: 'analysisStarted',
      rootPath: 'C:/repo',
    });
    expect(reduceCommitImpactState(cancelled, { type: 'message', message: analysisStarted })).toBe(
      cancelled,
    );
    expect(
      reduceCommitImpactState(cancelled, {
        type: 'message',
        message: ExtensionMessageSchema.parse({ type: 'analysisUnavailable', rootPath: null }),
      }),
    ).toEqual({ ...initialCommitImpactState, requestId: 1 });
  });

  it('restores only correlated serializable states', () => {
    const state = request(7, 'a'.repeat(40), null);
    expect(restoreCommitImpactState({ commitImpact: state })).toEqual(state);
    expect(
      restoreCommitImpactState({
        commitImpact: { ...state, commitSha: 'HEAD' },
      }),
    ).toEqual(initialCommitImpactState);
  });

  it('focuses terminal and parent-selection transitions only', () => {
    expect(shouldFocusCommitImpactStatus('loading', 'ready')).toBe(true);
    expect(shouldFocusCommitImpactStatus('loading', 'parent-selection')).toBe(true);
    expect(shouldFocusCommitImpactStatus('loading', 'error')).toBe(true);
    expect(shouldFocusCommitImpactStatus('editing', 'loading')).toBe(false);
  });
});

function request(requestId: number, commitSha: string, selectedParentSha: string | null) {
  return reduceCommitImpactState(
    reduceCommitImpactState(initialCommitImpactState, { type: 'open' }),
    { type: 'request', requestId, commitSha, selectedParentSha },
  );
}

function response(
  requestId: number,
  commitCharacter: string,
  options: {
    selectedParentSha?: string | null;
    parents?: string[];
    requiresParentSelection?: boolean;
  } = {},
) {
  const commitSha = commitCharacter.repeat(40);
  return ExtensionMessageSchema.parse({
    type: 'commitImpactResult',
    requestId,
    repositoryId: 'repo',
    commitSha,
    selectedParentSha: options.selectedParentSha ?? null,
    parentCommits: options.parents ?? [],
    requiresParentSelection: options.requiresParentSelection ?? false,
    result: null,
    ...(!options.requiresParentSelection ? { error: 'Unavailable' } : {}),
  });
}
