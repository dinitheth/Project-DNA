import { describe, expect, it } from 'vitest';
import { ExtensionMessageSchema } from '@project-dna/shared';
import {
  initialEvolutionComparisonState,
  reduceEvolutionComparisonState,
  restoreEvolutionComparisonState,
} from './evolution-comparison-state.js';

describe('evolution comparison state', () => {
  it('keeps the latest comparison when responses arrive in reverse order', () => {
    const first = select(0, 2, 3, 1, 2);
    const second = select(first.requestId + 1, 3, 4, 2, 3);
    const latest = receive(second, comparison(second));
    const late = receive(latest, comparison(first));
    expect(late.comparison?.fromVersion).toBe(2);
    expect(late.comparison?.toVersion).toBe(3);
  });

  it('rejects reversed selections and handles query failures', () => {
    const selected = select(0, 3, 3, 3, 2);
    const failed = receive(
      selected,
      ExtensionMessageSchema.parse({
        type: 'evolutionComparison',
        requestId: 0,
        analysisVersion: 3,
        fromVersion: 3,
        toVersion: 2,
        comparison: null,
        error: 'Invalid selection',
      }),
    );
    expect(failed.status).toBe('error');
    expect(failed.error).toBe('Invalid selection');
  });

  it('restores pending correlation for webview recreation', () => {
    const selected = select(7, 4, 4, 2, 4);
    expect(restoreEvolutionComparisonState({ evolutionComparison: selected })).toEqual(selected);
  });

  it('rejects malformed persisted comparison data', () => {
    expect(
      restoreEvolutionComparisonState({
        evolutionComparison: {
          ...initialEvolutionComparisonState,
          status: 'ready',
          comparison: { fromVersion: 'invalid' },
        },
      }),
    ).toEqual(initialEvolutionComparisonState);
  });
});

function select(
  requestId: number,
  analysisVersion: number,
  _unused: number,
  fromVersion: number,
  toVersion: number,
) {
  return reduceEvolutionComparisonState(initialEvolutionComparisonState, {
    type: 'select',
    requestId,
    analysisVersion,
    fromVersion,
    toVersion,
  });
}
function receive(
  state: ReturnType<typeof select>,
  message: ReturnType<typeof ExtensionMessageSchema.parse>,
) {
  return reduceEvolutionComparisonState(state, { type: 'message', message });
}
function comparison(state: ReturnType<typeof select>) {
  return ExtensionMessageSchema.parse({
    type: 'evolutionComparison',
    requestId: state.requestId,
    analysisVersion: state.analysisVersion,
    fromVersion: state.fromVersion,
    toVersion: state.toVersion,
    comparison: {
      fromVersion: state.fromVersion,
      toVersion: state.toVersion,
      addedEntities: [],
      removedEntities: [],
      changedEntities: [],
      healthDelta: { overall: 1, dimensions: {} },
      newRisks: [],
      resolvedRisks: [],
      addedEdges: 0,
      removedEdges: 0,
      newDomains: [],
      removedDomains: [],
      architecturalSignificance: 0.1,
    },
  });
}
