import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ImpactResultData, WorkingTreeImpactData } from '@project-dna/shared';
import { WorkingTreeImpactResultView, WorkingTreeImpactView } from './working-tree-impact-view.js';

describe('working-tree impact view', () => {
  it('makes filesystem analysis and staging metadata distinct', () => {
    const markup = renderToStaticMarkup(
      <WorkingTreeImpactResultView
        data={workingTreeData()}
        onOpenWorkspaceTarget={() => undefined}
        onSelectEntity={() => undefined}
        repositoryName="Project DNA"
      />,
    );
    expect(markup).toContain('Working-tree analysis');
    expect(markup).toContain('Repository: Project DNA');
    expect(markup).toContain('HEAD');
    expect(markup).toContain('Analyzed filesystem state');
    expect(markup).toContain('Current filesystem contents');
    expect(markup).toContain('Staging metadata only');
    expect(markup).toContain('index contents are not analyzed separately');
    expect(markup).toContain('Staged + unstaged');
    expect(markup).toContain('Untracked');
  });

  it('renders all change kinds, content kinds, and resolution states', () => {
    const markup = renderToStaticMarkup(
      <WorkingTreeImpactResultView
        data={workingTreeData()}
        onOpenWorkspaceTarget={() => undefined}
        onSelectEntity={() => undefined}
        repositoryName="repo"
      />,
    );
    expect(markup).toContain('src/added.ts');
    expect(markup).toContain('src/modified.ts');
    expect(markup).toContain('src/deleted.ts');
    expect(markup).toContain('src/new-name.ts');
    expect(markup).toContain('src/type-changed.ts');
    expect(markup).toContain('binary');
    expect(markup).toContain('symlink');
    expect(markup).toContain('submodule');
    expect(markup).toContain('unknown');
    expect(markup).toContain('Resolved');
    expect(markup).toContain('Unresolved');
    expect(markup).toContain('Unresolved changes');
    expect(markup).toContain('Refresh Project DNA to resolve it.');
    expect(markup).toContain('No clean HEAD-aligned baseline is available');
    expect(markup).toContain('saved analysis predates working-tree impact support');
    expect(markup).toContain('This file type is not analyzed as source.');
    expect(markup).toContain('no canonical file entity was found');
    expect(markup).toContain('Deleted source is unavailable');
  });

  it('reuses the existing impact presentation for resolved files', () => {
    const markup = renderToStaticMarkup(
      <WorkingTreeImpactResultView
        data={workingTreeData()}
        onOpenWorkspaceTarget={() => undefined}
        onSelectEntity={() => undefined}
        repositoryName="repo"
      />,
    );
    expect(markup).toContain('Impacted areas');
    expect(markup).toContain('Direct dependents');
    expect(markup).toContain('Evidence and paths');
    expect(markup).toContain('Before baseline');
    expect(markup).toContain('After analysis');
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain('aria-controls="working-tree-impact-after-src-added-ts"');
  });

  it('keeps loading, cancellation, error, and clean-tree states accessible', () => {
    const loading = renderToStaticMarkup(
      <WorkingTreeImpactView
        onCancel={() => undefined}
        onOpenWorkspaceTarget={() => undefined}
        onSelectEntity={() => undefined}
        repositoryName="repo"
        state={{ analysisVersion: 4, error: null, requestId: 1, result: null, status: 'loading' }}
      />,
    );
    expect(loading).toContain('role="status"');
    expect(loading).toContain('Cancel');
    const error = renderToStaticMarkup(
      <WorkingTreeImpactView
        onCancel={() => undefined}
        onOpenWorkspaceTarget={() => undefined}
        onSelectEntity={() => undefined}
        repositoryName="repo"
        state={{
          analysisVersion: 4,
          error: 'Unavailable',
          requestId: 1,
          result: null,
          status: 'error',
        }}
      />,
    );
    expect(error).toContain('role="alert"');
    expect(error).toContain('Unavailable');
    const clean = renderToStaticMarkup(
      <WorkingTreeImpactResultView
        data={{
          ...workingTreeData(),
          changedPaths: [],
          impacts: [],
          resolvedTargets: [],
          unresolvedPaths: [],
        }}
        onOpenWorkspaceTarget={() => undefined}
        onSelectEntity={() => undefined}
        repositoryName="repo"
      />,
    );
    expect(clean).toContain('Working tree is clean.');
    expect(clean).toContain('No resolved impact');
  });
});

function workingTreeData(): WorkingTreeImpactData {
  return {
    repositoryId: 'repo',
    headCommit: 'abcdef0123456789',
    changedPaths: [
      {
        kind: 'added',
        path: 'src/added.ts',
        staged: true,
        unstaged: false,
        untracked: false,
        contentKind: 'text',
      },
      {
        kind: 'modified',
        path: 'src/modified.ts',
        staged: true,
        unstaged: true,
        untracked: false,
        contentKind: 'text',
      },
      {
        kind: 'deleted',
        path: 'src/deleted.ts',
        staged: false,
        unstaged: true,
        untracked: false,
        contentKind: 'binary',
      },
      {
        kind: 'renamed',
        path: 'src/new-name.ts',
        previousPath: 'src/old-name.ts',
        staged: false,
        unstaged: true,
        untracked: false,
        contentKind: 'symlink',
      },
      {
        kind: 'type-changed',
        path: 'src/type-changed.ts',
        staged: false,
        unstaged: false,
        untracked: true,
        contentKind: 'submodule',
      },
      {
        kind: 'modified',
        path: 'src/unknown.dat',
        staged: false,
        unstaged: true,
        untracked: false,
        contentKind: 'unknown',
      },
    ],
    resolvedTargets: [
      { path: 'src/added.ts', side: 'after', entityId: 'file:src/added.ts', sourceAvailable: true },
      {
        path: 'src/deleted.ts',
        side: 'before',
        entityId: 'file:src/deleted.ts',
        sourceAvailable: false,
      },
    ],
    unresolvedPaths: [
      { path: 'src/new-name.ts', side: 'after', reason: 'analysis-refresh-required' },
      { path: 'src/modified.ts', side: 'before', reason: 'clean-baseline-unavailable' },
      { path: 'src/old.ts', side: 'before', reason: 'legacy-analysis-state-unavailable' },
      { path: 'src/type-changed.ts', side: 'after', reason: 'non-analyzable' },
      { path: 'src/unknown.dat', side: 'after', reason: 'missing-entity' },
    ],
    impacts: [
      { path: 'src/added.ts', side: 'after', result: impactResult('file:src/added.ts') },
      { path: 'src/deleted.ts', side: 'before', result: impactResult('file:src/deleted.ts') },
    ],
    changedEntityIds: ['file:src/added.ts'],
    impactedEntityIds: ['file:src/api.ts'],
    beforeAnalysisVersion: 3,
    afterAnalysisVersion: 4,
    warnings: ['Working-tree result uses current filesystem state.'],
    complete: false,
    truncations: [{ kind: 'max-targets', limit: 10 }],
  };
}

function impactResult(id: string): ImpactResultData {
  return {
    repositoryId: 'repo',
    analysisVersion: 4,
    target: { id, kind: 'file', name: id, path: id.replace('file:', ''), minimumDepth: 0 },
    directImpactedEntities: [
      { id: 'file:src/api.ts', kind: 'file', name: 'API', path: 'src/api.ts', minimumDepth: 1 },
    ],
    transitiveImpactedEntities: [],
    minimumDepth: 1,
    canonicalPaths: [],
    semanticEffects: {
      domains: [{ id: 'domain:core', name: 'Core', confidence: 1, entityCount: 1 }],
      capabilities: [],
      criticalComponents: [],
      risks: [],
      architecture: { layers: [], boundaryCrossings: [] },
    },
    score: {
      total: 60,
      components: [
        'dependency-reach',
        'critical-component-exposure',
        'domain-reach',
        'risk-exposure',
        'architecture-boundaries',
      ].map((kind) => ({
        kind: kind as ImpactResultData['score']['components'][number]['kind'],
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
