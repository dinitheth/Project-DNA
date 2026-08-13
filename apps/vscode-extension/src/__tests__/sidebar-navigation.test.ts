import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IProjectDNAService } from '@project-dna/dna-core';
import { ExtensionMessageSchema, Ok } from '@project-dna/shared';

vi.mock('vscode', () => ({
  Uri: {
    joinPath: () => ({ toString: () => 'vscode-resource' }),
  },
}));

import { SidebarProvider } from '../sidebar/sidebar-provider.js';

describe('SidebarProvider navigation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('delivers navigation while the webview is already resolved and ready', async () => {
    const harness = createHarness();
    harness.resolve();
    harness.receive({ type: 'ready', route: 'overview', generation: 0, revision: 0 });
    await harness.waitForNavigationCount(0);

    harness.provider.navigateTo('architecture');

    await harness.waitForNavigationCount(1);
    expect(harness.navigationMessages()).toEqual([
      {
        type: 'navigateTo',
        route: 'architecture',
        generation: 0,
        revision: 1,
        requestId: undefined,
      },
    ]);
  });

  it('keeps navigation pending until an unresolved webview becomes ready', async () => {
    const harness = createHarness();
    harness.provider.navigateTo('architecture');
    harness.resolve();

    expect(harness.navigationMessages()).toEqual([]);
    harness.receive({ type: 'ready', route: 'overview', generation: 0, revision: 0 });

    await harness.waitForNavigationCount(1);
    expect(harness.navigationMessages()).toEqual([
      {
        type: 'navigateTo',
        route: 'architecture',
        generation: 0,
        revision: 1,
        requestId: undefined,
      },
    ]);
  });

  it('restores the acknowledged route after webview recreation without echoing it', async () => {
    const harness = createHarness();
    harness.resolve();
    harness.receive({ type: 'ready', route: 'overview', generation: 0, revision: 0 });
    harness.receive({
      type: 'navigateTo',
      route: 'knowledge',
      generation: 0,
      revision: 0,
      requestId: 0,
    });
    await harness.waitForNavigationCount(1);
    expect(harness.navigationMessages()[0]).toEqual({
      type: 'navigateTo',
      route: 'knowledge',
      generation: 0,
      revision: 1,
      requestId: 0,
    });

    harness.disposeView();
    harness.clearMessages();
    harness.resolve();
    harness.receive({ type: 'ready', route: 'knowledge', generation: 0, revision: 1 });
    await vi.waitFor(() => expect(harness.unavailableMessages()).toHaveLength(1));

    expect(harness.navigationMessages()).toEqual([]);
  });

  it('ignores stale and duplicate webview navigation without creating echo loops', async () => {
    const harness = createHarness();
    harness.resolve();
    harness.receive({ type: 'ready', route: 'overview', generation: 0, revision: 0 });
    harness.receive({
      type: 'navigateTo',
      route: 'knowledge',
      generation: 0,
      revision: 0,
      requestId: 0,
    });
    await harness.waitForNavigationCount(1);
    harness.clearMessages();

    harness.receive({
      type: 'navigateTo',
      route: 'architecture',
      generation: 0,
      revision: 0,
      requestId: 1,
    });
    harness.receive({
      type: 'navigateTo',
      route: 'knowledge',
      generation: 0,
      revision: 1,
      requestId: 0,
    });
    await Promise.resolve();
    expect(harness.navigationMessages()).toEqual([]);

    harness.receive({
      type: 'navigateTo',
      route: 'dependencies',
      generation: 0,
      revision: 1,
      requestId: 1,
    });
    await harness.waitForNavigationCount(1);
    expect(harness.navigationMessages()).toEqual([
      { type: 'navigateTo', route: 'dependencies', generation: 0, revision: 2, requestId: 1 },
    ]);
  });

  it('keeps command navigation authoritative when a webview message races with it', async () => {
    const harness = createHarness();
    harness.resolve();
    harness.receive({ type: 'ready', route: 'overview', generation: 0, revision: 0 });
    await harness.waitForNavigationCount(0);

    harness.provider.navigateTo('architecture');
    harness.receive({
      type: 'navigateTo',
      route: 'knowledge',
      generation: 0,
      revision: 0,
      requestId: 0,
    });

    await harness.waitForNavigationCount(1);
    expect(harness.navigationMessages()).toEqual([
      {
        type: 'navigateTo',
        route: 'architecture',
        generation: 0,
        revision: 1,
        requestId: undefined,
      },
    ]);
  });

  it('advances a same-route command revision and rejects the queued webview request', async () => {
    const harness = createHarness();
    harness.resolve();
    harness.receive({ type: 'ready', route: 'overview', generation: 0, revision: 0 });
    await harness.waitForNavigationCount(0);

    harness.provider.navigateTo('architecture');
    await harness.waitForNavigationCount(1);
    harness.clearMessages();

    harness.provider.navigateTo('architecture');
    harness.receive({
      type: 'navigateTo',
      route: 'knowledge',
      generation: 0,
      revision: 1,
      requestId: 0,
    });

    await harness.waitForNavigationCount(1);
    expect(harness.navigationMessages()).toEqual([
      {
        type: 'navigateTo',
        route: 'architecture',
        generation: 0,
        revision: 2,
        requestId: undefined,
      },
    ]);
  });

  it('rebases a MAX_SAFE_INTEGER revision and rejects pre-rollover requests', async () => {
    const harness = createHarness();
    harness.resolve();
    harness.receive({
      type: 'ready',
      route: 'architecture',
      generation: 0,
      revision: Number.MAX_SAFE_INTEGER,
    });
    await harness.waitForNavigationCount(0);

    harness.provider.navigateTo('architecture');
    harness.receive({
      type: 'navigateTo',
      route: 'knowledge',
      generation: 0,
      revision: Number.MAX_SAFE_INTEGER,
      requestId: 0,
    });

    await harness.waitForNavigationCount(1);
    expect(harness.navigationMessages()).toEqual([
      {
        type: 'navigateTo',
        route: 'architecture',
        generation: 1,
        revision: 0,
        requestId: undefined,
      },
    ]);
  });

  it('retries an undelivered navigation when the webview is recreated', async () => {
    const harness = createHarness({ postResults: [true, false, true] });
    harness.resolve();
    harness.receive({ type: 'ready', route: 'overview', generation: 0, revision: 0 });
    await harness.waitForUnavailableCount(1);

    harness.provider.navigateTo('architecture');
    await harness.waitForNavigationAttempts(1);
    harness.disposeView();
    harness.resolve();
    harness.receive({ type: 'ready', route: 'overview', generation: 0, revision: 0 });

    await harness.waitForNavigationAttempts(2);
    expect(harness.navigationMessages()).toEqual([
      {
        type: 'navigateTo',
        route: 'architecture',
        generation: 0,
        revision: 1,
        requestId: undefined,
      },
      {
        type: 'navigateTo',
        route: 'architecture',
        generation: 0,
        revision: 1,
        requestId: undefined,
      },
    ]);
  });

  it('does not let a late successful delivery suppress the replacement webview', async () => {
    const oldDelivery = createDeferred<boolean>();
    const harness = createHarness({ navigationPostResults: [oldDelivery.promise, true] });
    harness.resolve();
    harness.receive({ type: 'ready', route: 'overview', generation: 0, revision: 0 });
    await harness.waitForUnavailableCount(1);

    harness.provider.navigateTo('architecture');
    await harness.waitForNavigationAttempts(1);
    harness.disposeView();
    harness.resolve();

    oldDelivery.resolve(true);
    await oldDelivery.promise;
    harness.receive({ type: 'ready', route: 'overview', generation: 0, revision: 0 });

    await harness.waitForNavigationAttempts(2);
    expect(harness.navigationMessages()).toEqual([
      {
        type: 'navigateTo',
        route: 'architecture',
        generation: 0,
        revision: 1,
        requestId: undefined,
      },
      {
        type: 'navigateTo',
        route: 'architecture',
        generation: 0,
        revision: 1,
        requestId: undefined,
      },
    ]);
  });

  it('ignores messages emitted by a disposed webview', async () => {
    const harness = createHarness();
    const firstView = harness.resolve();
    firstView.receive({ type: 'ready', route: 'overview', generation: 0, revision: 0 });
    await harness.waitForUnavailableCount(1);
    harness.disposeView();

    harness.resolve();
    harness.provider.navigateTo('architecture');
    firstView.receive({ type: 'ready', route: 'knowledge', generation: 0, revision: 9 });
    firstView.receive({
      type: 'navigateTo',
      route: 'knowledge',
      generation: 0,
      revision: 1,
      requestId: 0,
    });
    await Promise.resolve();

    expect(harness.navigationMessages()).toEqual([]);
    harness.receive({ type: 'ready', route: 'overview', generation: 0, revision: 0 });
    await harness.waitForNavigationCount(1);
    expect(harness.navigationMessages()).toEqual([
      {
        type: 'navigateTo',
        route: 'architecture',
        generation: 0,
        revision: 1,
        requestId: undefined,
      },
    ]);
  });
});

function createHarness(
  options: {
    postResults?: boolean[];
    navigationPostResults?: Array<boolean | Promise<boolean>>;
  } = {},
) {
  const service = {
    onProgress() {
      return () => undefined;
    },
    onReady() {
      return () => undefined;
    },
    getCurrent() {
      return Ok(null);
    },
  } as unknown as IProjectDNAService;
  const messages: unknown[] = [];
  let receiveMessage: ((message: unknown) => void) | undefined;
  let disposeView: (() => void) | undefined;
  const postResults = [...(options.postResults ?? [])];
  const navigationPostResults = [...(options.navigationPostResults ?? [])];
  const provider = new SidebarProvider(
    { toString: () => 'extension-uri' } as never,
    service,
    () => 'C:/repo',
  );

  return {
    provider,
    resolve() {
      let viewReceiveMessage: ((message: unknown) => void) | undefined;
      provider.resolveWebviewView(
        {
          onDidDispose: (listener: () => void) => {
            disposeView = listener;
            return { dispose() {} };
          },
          webview: {
            options: {},
            html: '',
            cspSource: 'vscode-webview:',
            asWebviewUri: () => ({ toString: () => 'vscode-resource' }),
            onDidReceiveMessage: (listener: (message: unknown) => void) => {
              receiveMessage = listener;
              viewReceiveMessage = listener;
              return { dispose() {} };
            },
            postMessage: async (message: unknown) => {
              messages.push(message);
              if (
                typeof message === 'object' &&
                message !== null &&
                'type' in message &&
                message.type === 'navigateTo'
              ) {
                return (await navigationPostResults.shift()) ?? true;
              }
              return postResults.shift() ?? true;
            },
          },
        } as never,
        {} as never,
        {} as never,
      );
      return {
        receive(message: unknown) {
          if (!viewReceiveMessage) throw new Error('Webview is not resolved');
          viewReceiveMessage(message);
        },
      };
    },
    receive(message: unknown) {
      if (!receiveMessage) throw new Error('Webview is not resolved');
      receiveMessage(message);
    },
    disposeView() {
      if (!disposeView) throw new Error('Webview is not resolved');
      disposeView();
    },
    clearMessages() {
      messages.length = 0;
    },
    navigationMessages() {
      return messages
        .map((message) => ExtensionMessageSchema.parse(message))
        .filter((message) => message.type === 'navigateTo');
    },
    unavailableMessages() {
      return messages
        .map((message) => ExtensionMessageSchema.parse(message))
        .filter((message) => message.type === 'analysisUnavailable');
    },
    async waitForNavigationCount(count: number) {
      if (count === 0) {
        await this.waitForUnavailableCount(1);
        return;
      }
      await vi.waitFor(() => expect(this.navigationMessages()).toHaveLength(count));
    },
    async waitForNavigationAttempts(count: number) {
      await vi.waitFor(() => expect(this.navigationMessages()).toHaveLength(count));
    },
    async waitForUnavailableCount(count: number) {
      await vi.waitFor(() => expect(this.unavailableMessages()).toHaveLength(count));
    },
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
