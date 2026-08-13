import { describe, expect, it } from 'vitest';
import { ExtensionMessageSchema, type WebviewMessage } from '@project-dna/shared';
import {
  SidebarNavigationController,
  createInitialNavigationState,
  initialNavigationState,
  type NavigationState,
} from './navigation-state';

describe('sidebar navigation state', () => {
  it('restores valid persisted state and rejects invalid state', () => {
    expect(
      createInitialNavigationState({ route: 'knowledge', generation: 2, revision: 7 }),
    ).toEqual({ route: 'knowledge', generation: 2, revision: 7 });
    expect(createInitialNavigationState({ route: 'unknown', generation: 2, revision: 7 })).toEqual(
      initialNavigationState,
    );
  });

  it('preserves unrelated persisted webview state', () => {
    const harness = createHarness();
    harness.persisted = { entityDetail: { status: 'loading' } };
    const controller = new SidebarNavigationController(harness.transport);
    controller.start();

    expect(harness.persisted).toEqual(
      expect.objectContaining({ entityDetail: { status: 'loading' }, route: 'overview' }),
    );
  });

  it('persists pending state and resumes it after recreation without request-id collision', () => {
    const harness = createHarness();
    const first = new SidebarNavigationController(harness.transport);
    first.start();
    first.navigate('knowledge');
    first.navigate('dependencies');
    expect(persistedState(harness.persisted).inFlight).toEqual({
      requestId: 0,
      route: 'knowledge',
      generation: 0,
      revision: 0,
    });
    expect(persistedState(harness.persisted).queuedRoute).toBe('dependencies');
    expect(persistedState(harness.persisted).nextRequestId).toBe(1);

    const recreated = new SidebarNavigationController(harness.transport);
    recreated.start();
    expect(harness.navigationMessages()).toContainEqual({
      type: 'navigateTo',
      route: 'knowledge',
      generation: 0,
      revision: 0,
      requestId: 0,
    });
    recreated.receive(navigationMessage('knowledge', 0, 1, 0));

    expect(harness.navigationMessages()).toContainEqual({
      type: 'navigateTo',
      route: 'dependencies',
      generation: 0,
      revision: 1,
      requestId: 1,
    });
    expect(recreated.getSnapshot()).toEqual({ route: 'dependencies', generation: 0, revision: 1 });
    expect(persistedState(harness.persisted).nextRequestId).toBe(2);
  });

  it('rebases after MAX_SAFE_INTEGER without producing an unsafe version', () => {
    const harness = createHarness({
      route: 'architecture',
      generation: 0,
      revision: Number.MAX_SAFE_INTEGER,
    });
    const controller = new SidebarNavigationController(harness.transport);
    controller.start();
    controller.receive(navigationMessage('knowledge', 1, 0));

    expect(controller.getSnapshot()).toEqual({ route: 'knowledge', generation: 1, revision: 0 });
    expect(harness.navigationMessages()).toEqual([]);
  });

  it('rejects stale pre-rollover and duplicate acknowledgments', () => {
    const harness = createHarness({ route: 'architecture', generation: 1, revision: 0 });
    const controller = new SidebarNavigationController(harness.transport);
    controller.start();
    controller.receive(navigationMessage('knowledge', 0, 0));
    controller.receive(navigationMessage('dependencies', 1, 0));
    expect(controller.getSnapshot()).toEqual({ route: 'architecture', generation: 1, revision: 0 });
  });
});

function navigationMessage(
  route: NavigationState['route'],
  generation: number,
  revision: number,
  requestId?: number,
) {
  const message = ExtensionMessageSchema.parse({
    type: 'navigateTo',
    route,
    generation,
    revision,
    requestId,
  });
  if (message.type !== 'navigateTo') throw new Error('Expected a navigation message');
  return message;
}

function persistedState(candidate: unknown) {
  return candidate as {
    inFlight?: { requestId: number; route: string; generation: number; revision: number };
    queuedRoute?: string;
    nextRequestId: number;
  };
}

function createHarness(initial?: NavigationState) {
  const messages: WebviewMessage[] = [];
  const persistedStates: unknown[] = [];
  const harness = {
    persisted: initial ? { ...initial, nextRequestId: 0 } : (undefined as unknown),
    persistedStates,
    transport: {
      getState: () => harness.persisted,
      setState: (state: unknown) => {
        harness.persisted = state;
        persistedStates.push(state);
      },
      postMessage: (message: WebviewMessage) => messages.push(message),
    },
    navigationMessages: () => messages.filter((message) => message.type === 'navigateTo'),
  };
  return harness;
}
