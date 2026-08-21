import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ImpactResultData } from '@project-dna/shared';
import { ImpactResultView, ImpactView, SourceNavigationButton } from './impact-view.js';

describe('impact view', () => {
  it('connects the evidence disclosure to a stable controlled region', () => {
    const markup = renderToStaticMarkup(
      <ImpactResultView
        onOpenWorkspaceTarget={() => undefined}
        onSelectEntity={() => undefined}
        result={result()}
      />,
    );
    const controls = markup.match(/aria-controls="([^"]+)"/u)?.[1];
    expect(controls).toBeTruthy();
    expect(markup).toContain(`id="${controls}"`);
    expect(markup).toContain('aria-expanded="false"');
  });
  it('renders explainable impact result sections with textual severity', () => {
    const markup = renderToStaticMarkup(
      <ImpactResultView
        result={result()}
        onOpenWorkspaceTarget={() => undefined}
        onSelectEntity={() => undefined}
      />,
    );
    expect(markup).toContain('Blast radius');
    expect(markup).toContain('72');
    expect(markup).toContain('aria-label="Impact severity: High, 72 out of 100"');
    expect(markup).toContain('role="progressbar"');
    expect(markup).toContain('Direct dependents');
    expect(markup).toContain('Transitive dependents');
    expect(markup).toContain('Affected domains');
    expect(markup).toContain('Billing');
    expect(markup).toContain('Critical components');
    expect(markup).toContain('Payment service');
    expect(markup).toContain('Risks');
    expect(markup).toContain('Architecture impact');
    expect(markup).toContain('Domain → Infrastructure');
    expect(markup).toContain('Why this score');
    expect(markup).toContain('Raw input: 2');
    expect(markup).toContain('Domains');
    expect(markup).toContain('Risks');
    expect(markup).toContain('Critical');
    expect(markup).toContain('Boundaries');
    expect(markup).toContain('Evidence and paths');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('title="src/api.ts"');
  });

  it('keeps loading, cancellation, empty, and error states accessible', () => {
    expect(
      renderToStaticMarkup(
        <ImpactView
          state={{
            status: 'loading',
            target: { kind: 'file', path: 'src/a.ts' },
            result: null,
            error: null,
          }}
          onCancel={() => undefined}
          onOpenWorkspaceTarget={() => undefined}
          onSelectEntity={() => undefined}
        />,
      ),
    ).toContain('role="status"');
    expect(
      renderToStaticMarkup(
        <ImpactView
          state={{
            status: 'loading',
            target: { kind: 'file', path: 'src/a.ts' },
            result: null,
            error: null,
          }}
          onCancel={() => undefined}
          onOpenWorkspaceTarget={() => undefined}
          onSelectEntity={() => undefined}
        />,
      ),
    ).toContain('Cancel');
    expect(
      renderToStaticMarkup(
        <ImpactView
          state={{
            status: 'error',
            target: { kind: 'file', path: 'src/a.ts' },
            result: null,
            error: 'Unavailable',
          }}
          onCancel={() => undefined}
          onOpenWorkspaceTarget={() => undefined}
          onSelectEntity={() => undefined}
        />,
      ),
    ).toContain('role="alert"');
    expect(
      renderToStaticMarkup(
        <ImpactView
          state={{
            status: 'cancelled',
            target: { kind: 'file', path: 'src/a.ts' },
            result: null,
            error: null,
          }}
          onCancel={() => undefined}
          onOpenWorkspaceTarget={() => undefined}
          onSelectEntity={() => undefined}
        />,
      ),
    ).toContain('Impact analysis cancelled.');
    expect(
      renderToStaticMarkup(
        <ImpactResultView
          result={emptyResult()}
          onOpenWorkspaceTarget={() => undefined}
          onSelectEntity={() => undefined}
        />,
      ),
    ).toContain('No direct dependents found.');
  });

  it('separates traversal limits from unavailable semantic evidence', () => {
    const markup = renderToStaticMarkup(
      <ImpactResultView
        result={{
          ...emptyResult(),
          complete: false,
          warnings: [
            'Semantic enrichment incomplete: risks unavailable',
            'Semantic enrichment incomplete: domains unavailable',
          ],
          truncations: [{ kind: 'max-depth', limit: 8, atEntityId: 'file:a.ts' }],
        }}
        onOpenWorkspaceTarget={() => undefined}
        onSelectEntity={() => undefined}
      />,
    );
    expect(markup).toContain('Traversal limited');
    expect(markup).toContain('Depth bound reached at 8');
    expect(markup).toContain('Semantic evidence incomplete');
    expect(markup).toContain(
      'Risk analysis unavailable; no conclusion about affected risks can be made.',
    );
    expect(markup).not.toContain('No retained risks affect this blast radius.');
    expect(markup).not.toContain('This result is incomplete.');
  });

  it.each([
    ['opened', 'Source opened'],
    ['missing', 'Source missing'],
    ['rejected', 'Source navigation rejected'],
    ['failed', 'Source navigation failed'],
  ] as const)('surfaces workspace target %s outcomes accessibly', (outcome, label) => {
    const markup = renderToStaticMarkup(
      <ImpactView
        navigationFeedback={{
          requestId: 4,
          path: 'src/missing.ts',
          outcome,
          message: 'File operation result.',
        }}
        state={{ status: 'idle', target: null, result: null, error: null }}
        onCancel={() => undefined}
        onOpenWorkspaceTarget={() => undefined}
        onSelectEntity={() => undefined}
      />,
    );
    expect(markup).toContain(label);
    expect(markup).toContain('src/missing.ts');
    expect(markup).toContain('File operation result.');
    expect(markup).toContain('role="status"');
  });

  it('routes critical-component and evidence source actions through canonical paths', () => {
    const open = vi.fn();
    const button = SourceNavigationButton({
      path: 'src/payments.ts',
      onOpenWorkspaceTarget: open,
    });
    button.props.onClick();
    const markup = renderToStaticMarkup(
      <ImpactResultView
        result={result()}
        onOpenWorkspaceTarget={open}
        onSelectEntity={() => undefined}
      />,
    );
    expect(open).toHaveBeenCalledWith('src/payments.ts');
    expect(markup).toContain('Open source');
    expect(markup).toContain('title="Payment service"');
  });

  it('suppresses current-workspace actions for historical results', () => {
    const markup = renderToStaticMarkup(
      <ImpactResultView
        historical
        result={result()}
        onOpenWorkspaceTarget={() => undefined}
        onSelectEntity={() => undefined}
      />,
    );
    expect(markup).toContain('Historical source');
    expect(markup).toContain('current workspace navigation is unavailable');
    expect(markup).not.toContain('Open source');
    expect(markup).not.toContain('>Details<');
  });
});

function result(): ImpactResultData {
  return {
    ...emptyResult(),
    target: {
      id: 'file:src/payments.ts',
      kind: 'file',
      name: 'Payment service',
      path: 'src/payments.ts',
      minimumDepth: 0,
    },
    directImpactedEntities: [
      { id: 'file:src/api.ts', kind: 'file', name: 'API', path: 'src/api.ts', minimumDepth: 1 },
    ],
    transitiveImpactedEntities: [
      { id: 'file:src/app.ts', kind: 'file', name: 'App', path: 'src/app.ts', minimumDepth: 2 },
    ],
    score: {
      total: 72,
      components: scoreComponents().map((component) =>
        component.kind === 'dependency-reach'
          ? { ...component, rawInput: 2, normalizedValue: 0.2, weight: 0.3, contribution: 6 }
          : component,
      ),
    },
    semanticEffects: {
      domains: [
        {
          id: 'billing',
          name: 'Billing',
          confidence: 1,
          entityCount: 1,
        },
      ],
      capabilities: [],
      criticalComponents: [
        {
          id: 'critical',
          entityId: 'file:src/payments.ts',
          name: 'Payment service',
          path: 'src/payments.ts',
          criticality: 'high',
          score: 1,
          reason: 'central',
        },
      ],
      risks: [
        {
          id: 'risk',
          type: 'high-complexity',
          severity: 'high',
          affectedEntityCount: 0,
          description: 'Risk',
        },
      ],
      architecture: {
        layers: [],
        boundaryCrossings: [
          {
            fromLayer: 'Domain',
            toLayer: 'Infrastructure',
            dependentId: 'file:src/api.ts',
            dependencyId: 'file:src/payments.ts',
          },
        ],
      },
    },
    warnings: ['Partial semantic data'],
    complete: false,
    truncations: [{ kind: 'max-entities', limit: 1, atEntityId: 'file:src/app.ts' }],
  };
}
function emptyResult(): ImpactResultData {
  return {
    repositoryId: 'repo',
    analysisVersion: 3,
    target: { id: 'file:src/a.ts', kind: 'file', name: 'A', path: 'src/a.ts', minimumDepth: 0 },
    directImpactedEntities: [],
    transitiveImpactedEntities: [],
    minimumDepth: null,
    canonicalPaths: [],
    semanticEffects: {
      domains: [],
      capabilities: [],
      criticalComponents: [],
      risks: [],
      architecture: { layers: [], boundaryCrossings: [] },
    },
    score: { total: 0, components: scoreComponents() },
    evidence: [],
    warnings: [],
    complete: true,
    truncations: [],
    appliedBounds: { maxDepth: 8, maxEntities: 500, maxEvidencePaths: 1 },
  };
}

function scoreComponents(): ImpactResultData['score']['components'] {
  const kinds: ImpactResultData['score']['components'][number]['kind'][] = [
    'dependency-reach',
    'critical-component-exposure',
    'domain-reach',
    'risk-exposure',
    'architecture-boundaries',
  ];
  return kinds.map((kind) => ({
    kind,
    rawInput: 0,
    normalizedValue: 0,
    weight: 0,
    contribution: 0,
    evidenceIds: [],
    status: 'available',
  }));
}
