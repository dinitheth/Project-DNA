import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ImpactResultData } from '@project-dna/shared';
import { ImpactResultView, ImpactView } from './impact-view.js';

describe('impact view', () => {
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
    expect(markup).toContain('Evidence and paths');
    expect(markup).toContain('aria-expanded="false"');
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
