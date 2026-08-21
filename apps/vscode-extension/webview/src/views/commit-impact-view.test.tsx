import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CommitImpactData } from '@project-dna/shared';
import { CommitImpactResultView, CommitImpactView } from './commit-impact-view.js';
import { initialCommitImpactState } from '../state/commit-impact-state.js';

describe('Commit Impact UI', () => {
  it('presents an explicit historical commit input without working-tree claims', () => {
    const markup = renderToStaticMarkup(
      <CommitImpactView
        onCancel={() => undefined}
        onClose={() => undefined}
        onRequest={() => undefined}
        repositoryName="Project DNA"
        state={{ ...initialCommitImpactState, visible: true, status: 'editing' }}
      />,
    );

    expect(markup).toContain('Commit Impact');
    expect(markup).toContain('Historical analysis');
    expect(markup).toContain('Commit SHA');
    expect(markup).not.toContain('Working-tree analysis');
    expect(markup).not.toContain('Staged');
    expect(markup).not.toContain('GitHub');
  });

  it('requires explicit native merge-parent selection and rejects combined-diff wording', () => {
    const markup = renderToStaticMarkup(
      <CommitImpactView
        onCancel={() => undefined}
        onClose={() => undefined}
        onRequest={() => undefined}
        repositoryName="Project DNA"
        state={{
          ...initialCommitImpactState,
          visible: true,
          status: 'parent-selection',
          commitSha: 'a'.repeat(40),
          parentCommits: ['b'.repeat(40), 'c'.repeat(40)],
        }}
      />,
    );

    expect(markup).toContain('<select');
    expect(markup).toContain('Compared against');
    expect(markup).toContain('not a combined merge diff');
    expect(markup).toContain('disabled=""');
  });

  it('renders root, deleted, renamed, and special-file semantics explicitly', () => {
    const data = commitData();
    const markup = renderToStaticMarkup(<CommitImpactResultView data={data} />);

    expect(markup).toContain('Empty tree');
    expect(markup).toContain(
      'Deleted from this commit; analysis uses the retained parent-tree entity.',
    );
    expect(markup).toContain('src/old.ts -&gt; src/new.ts');
    expect(markup).toContain('Binary file; source analysis unavailable.');
    expect(markup).toContain('Before: Resolved');
    expect(markup).toContain('After: Not applicable');
    expect(markup).toContain('<ul');
    expect(markup).not.toContain('role="listbox"');
    expect(markup).not.toContain('role="option"');
    expect(markup).not.toContain('aria-selected');
  });

  it('distinguishes unavailable semantic collections from empty change sets', () => {
    const data = commitData();
    const markup = renderToStaticMarkup(
      <CommitImpactResultView
        data={{
          ...data,
          changeSet: {
            ...data.changeSet!,
            unavailableCollections: ['domains', 'risks', 'architecture'],
          },
        }}
      />,
    );

    expect(markup).toContain('Domain changes');
    expect(markup).toContain('Risk changes');
    expect(markup).toContain('Architecture membership changes');
    expect(markup.match(/Unavailable/gu)?.length).toBeGreaterThanOrEqual(3);
  });

  it('reuses impact presentation without exposing current-workspace navigation', () => {
    const markup = renderToStaticMarkup(<CommitImpactResultView data={commitData()} />);

    expect(markup).toContain('Impact summary');
    expect(markup).toContain(
      'Historical source available for analysis; current workspace navigation unavailable.',
    );
    expect(markup).not.toContain('Open source');
    expect(markup).not.toContain('>Details<');
  });

  it('never reports unresolved-only historical evidence as zero or Low impact', () => {
    const data = commitData();
    const markup = renderToStaticMarkup(
      <CommitImpactResultView
        data={{
          ...data,
          impacts: [],
          summary: { ...data.summary, highestScore: null },
          unresolved: [{ side: 'after', path: 'assets/logo.bin', reason: 'binary-not-analyzable' }],
          complete: false,
        }}
      />,
    );

    expect(markup).toContain('Unavailable');
    expect(markup).toContain('not treated as zero impact');
    expect(markup).not.toContain('Highest target impact</span><strong class="text-xs">Low');
  });
});

function commitData(): CommitImpactData {
  const commitSha = 'a'.repeat(40);
  const digest = 'd'.repeat(64);
  const emptyTree = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
  const before = {
    repositoryId: 'repo',
    commitSha: null,
    treeSha: emptyTree,
    parentCommitSha: null,
    parentTreeSha: null,
    analysisConfigFingerprint: digest,
    contentFingerprint: digest,
    source: 'materialized' as const,
  };
  const after = { ...before, commitSha, treeSha: commitSha };
  const impact = impactResult();
  return {
    repositoryId: 'repo',
    commitSha,
    parentCommits: [],
    selectedParentSha: null,
    changedFiles: [
      {
        kind: 'deleted',
        path: 'src/deleted.ts',
        oldBlobSha: 'b'.repeat(40),
        newBlobSha: null,
        oldMode: '100644',
        newMode: null,
        contentKind: 'text',
        binary: false,
        gitlink: false,
      },
      {
        kind: 'renamed',
        path: 'src/new.ts',
        previousPath: 'src/old.ts',
        oldBlobSha: 'b'.repeat(40),
        newBlobSha: 'c'.repeat(40),
        oldMode: '100644',
        newMode: '100644',
        contentKind: 'text',
        binary: false,
        gitlink: false,
      },
      {
        kind: 'added',
        path: 'assets/logo.bin',
        oldBlobSha: null,
        newBlobSha: 'e'.repeat(40),
        oldMode: null,
        newMode: '100644',
        contentKind: 'binary',
        binary: true,
        gitlink: false,
      },
      {
        kind: 'type-changed',
        path: 'src/link.ts',
        oldBlobSha: 'f'.repeat(40),
        newBlobSha: '1'.repeat(40),
        oldMode: '100644',
        newMode: '120000',
        contentKind: 'symlink',
        binary: false,
        gitlink: false,
      },
      {
        kind: 'modified',
        path: 'vendor/library',
        oldBlobSha: '2'.repeat(40),
        newBlobSha: '3'.repeat(40),
        oldMode: '160000',
        newMode: '160000',
        contentKind: 'submodule',
        binary: false,
        gitlink: true,
      },
    ],
    before,
    after,
    changeSet: {
      addedEntityIds: ['file:src/new.ts'],
      removedEntityIds: ['file:src/old.ts'],
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
      unavailableCollections: [],
    },
    impacts: [
      {
        side: 'before',
        path: 'src/deleted.ts',
        entityId: 'file:src/deleted.ts',
        sourceAvailable: true,
        provenance: before,
        result: impact,
      },
      {
        side: 'after',
        path: 'src/new.ts',
        previousPath: 'src/old.ts',
        entityId: 'file:src/new.ts',
        sourceAvailable: true,
        provenance: after,
        result: {
          ...impact,
          target: { ...impact.target, id: 'file:src/new.ts', path: 'src/new.ts', name: 'new.ts' },
        },
      },
    ],
    summary: {
      changedEntityIds: ['file:src/deleted.ts', 'file:src/new.ts'],
      impactedEntityIds: ['file:src/dependent.ts'],
      directDependentIds: ['file:src/dependent.ts'],
      transitiveDependentIds: [],
      domainIds: ['domain:orders'],
      capabilityIds: [],
      criticalComponentIds: [],
      riskIds: [],
      architectureLayers: ['domain'],
      boundaryEvidence: [],
      highestScore: 42,
    },
    unresolved: [{ side: 'after', path: 'assets/logo.bin', reason: 'binary-not-analyzable' }],
    warnings: ['binary-not-analyzable'],
    complete: false,
    truncations: [],
  };
}

function impactResult() {
  return {
    repositoryId: 'repo',
    analysisVersion: 0,
    target: {
      id: 'file:src/deleted.ts',
      kind: 'file' as const,
      name: 'deleted.ts',
      path: 'src/deleted.ts',
      minimumDepth: 0,
    },
    directImpactedEntities: [
      {
        id: 'file:src/dependent.ts',
        kind: 'file' as const,
        name: 'dependent.ts',
        path: 'src/dependent.ts',
        minimumDepth: 1,
      },
    ],
    transitiveImpactedEntities: [],
    minimumDepth: 1,
    canonicalPaths: [],
    semanticEffects: {
      domains: [],
      capabilities: [],
      criticalComponents: [],
      risks: [],
      architecture: { layers: [], boundaryCrossings: [] },
    },
    score: {
      total: 42,
      components: [
        'dependency-reach',
        'critical-component-exposure',
        'domain-reach',
        'risk-exposure',
        'architecture-boundaries',
      ].map((kind) => ({
        kind: kind as
          | 'dependency-reach'
          | 'critical-component-exposure'
          | 'domain-reach'
          | 'risk-exposure'
          | 'architecture-boundaries',
        rawInput: 0,
        normalizedValue: 0,
        weight: 0,
        contribution: 0,
        evidenceIds: [],
        status: 'available' as const,
      })),
    },
    evidence: [],
    warnings: [],
    complete: true,
    truncations: [],
    appliedBounds: { maxDepth: 8, maxEntities: 500, maxEvidencePaths: 1 },
  };
}
