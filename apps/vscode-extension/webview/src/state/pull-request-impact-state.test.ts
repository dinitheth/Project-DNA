import { describe, expect, it } from 'vitest';
import { ExtensionMessageSchema } from '@project-dna/shared';
import {
  initialPullRequestImpactState,
  reducePullRequestImpactState,
  restorePullRequestImpactState,
} from './pull-request-impact-state.js';

describe('pull request impact state', () => {
  it('accepts only the active base/head request identity', () => {
    const first = request(1, 'a', 'b');
    const second = reducePullRequestImpactState(first, {
      type: 'request',
      requestId: 2,
      baseSha: 'c'.repeat(40),
      headSha: 'd'.repeat(40),
    });
    expect(
      reducePullRequestImpactState(second, { type: 'message', message: response(1, 'a', 'b') }),
    ).toBe(second);
    expect(
      reducePullRequestImpactState(second, { type: 'message', message: response(2, 'c', 'e') }),
    ).toBe(second);
  });

  it('suppresses cancelled results and clears on workspace unavailability', () => {
    const loading = request(3, 'a', 'b');
    const cancelled = reducePullRequestImpactState(loading, { type: 'cancel', requestId: 3 });
    expect(
      reducePullRequestImpactState(cancelled, { type: 'message', message: response(3, 'a', 'b') }),
    ).toBe(cancelled);
    expect(
      reducePullRequestImpactState(cancelled, {
        type: 'message',
        message: ExtensionMessageSchema.parse({ type: 'analysisUnavailable', rootPath: null }),
      }),
    ).toEqual({ ...initialPullRequestImpactState, requestId: 3 });
  });

  it('rejects malformed persisted state and restores loading requests safely', () => {
    const loading = request(4, 'a', 'b');
    expect(restorePullRequestImpactState({ pullRequestImpact: loading })).toEqual(loading);
    expect(
      restorePullRequestImpactState({ pullRequestImpact: { ...loading, baseSha: 'HEAD' } }),
    ).toEqual(initialPullRequestImpactState);
  });
});

function request(requestId: number, base: string, head: string) {
  return reducePullRequestImpactState(
    reducePullRequestImpactState(initialPullRequestImpactState, { type: 'open' }),
    { type: 'request', requestId, baseSha: base.repeat(40), headSha: head.repeat(40) },
  );
}

function response(requestId: number, base: string, head: string) {
  return ExtensionMessageSchema.parse({
    type: 'pullRequestImpactResult',
    requestId,
    baseSha: base.repeat(40),
    headSha: head.repeat(40),
    mergeBaseSha: null,
    result: null,
    error: 'Unavailable',
  });
}
