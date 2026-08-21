import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PullRequestImpactData } from '@project-dna/shared';
import { initialPullRequestImpactState } from '../state/pull-request-impact-state.js';
import { PullRequestImpactResultView, PullRequestImpactView } from './pull-request-impact-view.js';

describe('PR Impact UI', () => {
  it('uses exact historical range wording and full SHA inputs', () => {
    const markup = renderToStaticMarkup(
      <PullRequestImpactView
        repositoryName="Project DNA"
        state={{ ...initialPullRequestImpactState, visible: true, status: 'editing' }}
        onCancel={() => undefined}
        onClose={() => undefined}
        onRequest={() => undefined}
      />,
    );
    expect(markup).toContain('PR Impact');
    expect(markup).toContain('Historical analysis');
    expect(markup).toContain('Final base tree compared with final head tree.');
    expect(markup).toContain('Current workspace contents are not used.');
    expect(markup).toContain('Current staging state is not used.');
    expect(markup).toContain('maxLength="40"');
    expect(markup).not.toContain('GitHub');
  });

  it('shows highest affected-target score, historical provenance, and meaningful expandable files', () => {
    const markup = renderToStaticMarkup(<PullRequestImpactResultView data={data()} />);
    expect(markup).toContain('Highest affected-target score');
    expect(markup).not.toContain('PR score');
    expect(markup).not.toContain('Total PR impact');
    expect(markup).toContain('Merge base');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain(
      'Deleted from this range; analysis uses the retained baseline entity.',
    );
    expect(markup).toContain('Semantic collection unavailable; this is not an empty result.');
  });
});

function data(): PullRequestImpactData {
  const base = 'a'.repeat(40);
  const head = 'b'.repeat(40);
  const digest = 'd'.repeat(64);
  const provenance = {
    kind: 'git-pull-request' as const,
    repositoryId: 'repo',
    baseCommitSha: base,
    headCommitSha: head,
    baseTreeSha: base,
    headTreeSha: head,
    mergeBaseSha: null,
    analysisConfigFingerprint: digest,
    baseContentFingerprint: digest,
    headContentFingerprint: digest,
    gitVersion: '2.50.0',
    renameDetectionPolicy: 'find-renames',
    beforeSource: 'persisted' as const,
    afterSource: 'materialized' as const,
    changedFileFingerprint: digest,
    requestFingerprint: digest,
  };
  return {
    repositoryId: 'repo',
    baseCommitSha: base,
    headCommitSha: head,
    baseTreeSha: base,
    headTreeSha: head,
    mergeBaseSha: null,
    changedFiles: [
      {
        kind: 'deleted',
        path: 'src/deleted.ts',
        oldBlobSha: base,
        newBlobSha: null,
        oldMode: '100644',
        newMode: null,
        contentKind: 'text',
        binary: false,
        gitlink: false,
      },
    ],
    beforeProvenance: provenance,
    afterProvenance: provenance,
    changeSet: {
      addedEntityIds: [],
      removedEntityIds: [],
      modifiedEntities: [],
      addedRelationships: [],
      removedRelationships: [],
      modifiedRelationships: [],
      addedDomainIds: [],
      removedDomainIds: [],
      modifiedDomains: [],
      addedRiskIds: [],
      resolvedRiskIds: [],
      modifiedRisks: [],
      domainMembershipChanges: [],
      architectureMembershipChanges: [],
      unavailableCollections: ['domains'],
    },
    impacts: [],
    summary: {
      changedEntityIds: [],
      impactedEntityIds: [],
      directDependentIds: [],
      transitiveDependentIds: [],
      domainIds: [],
      capabilityIds: [],
      criticalComponentIds: [],
      riskIds: [],
      architectureLayers: [],
      boundaryEvidence: [],
      highestScore: null,
    },
    warnings: [],
    complete: false,
    unresolved: [{ side: 'before', path: 'src/deleted.ts', reason: 'missing-entity' }],
    truncations: [],
  };
}
