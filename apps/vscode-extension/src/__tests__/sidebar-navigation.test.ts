import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IProjectDNAService } from '@project-dna/dna-core';
import { ExtensionMessageSchema, Ok } from '@project-dna/shared';

vi.mock('vscode', () => ({
  Uri: {
    joinPath: () => ({ toString: () => 'vscode-resource' }),
    file: (fsPath: string) => ({ fsPath }),
  },
  commands: { executeCommand: vi.fn() },
  workspace: { openTextDocument: vi.fn() },
  window: { showTextDocument: vi.fn() },
}));

import { SidebarProvider } from '../sidebar/sidebar-provider.js';
import { isPathInside } from '../sidebar/sidebar-provider.js';
import * as vscode from 'vscode';

describe('SidebarProvider navigation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts nested targets only when they remain inside the workspace', () => {
    expect(isPathInside('C:/repo', 'C:/repo/src/index.ts')).toBe(true);
    expect(isPathInside('C:/repo', 'C:/other/index.ts')).toBe(false);
    expect(isPathInside('C:/repo', 'C:/repo/../secrets.txt')).toBe(false);
    expect(isPathInside('C:/repo', 'C:/repo/..')).toBe(false);
  });

  it('opens files and reveals directories from the active workspace', async () => {
    const root = await createTemporaryWorkspace();
    const sourceDirectory = join(root, 'src');
    const sourceFile = join(sourceDirectory, 'index.ts');
    await mkdir(sourceDirectory);
    await writeFile(sourceFile, 'export {};');
    vi.mocked(vscode.workspace.openTextDocument).mockImplementation(async (uri) => uri as never);

    const harness = createHarness({ rootPath: root });
    harness.resolve();
    harness.receive({ type: 'openWorkspaceTarget', requestId: 0, path: 'src/index.ts' });
    await harness.waitForWorkspaceTargetResultCount(1);
    harness.receive({ type: 'openWorkspaceTarget', requestId: 1, path: 'src' });
    await harness.waitForWorkspaceTargetResultCount(2);

    expect(vscode.workspace.openTextDocument).toHaveBeenCalledWith(
      expect.objectContaining({ fsPath: sourceFile }),
    );
    expect(vscode.window.showTextDocument).toHaveBeenCalledWith(expect.anything(), {
      preview: true,
    });
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'revealInExplorer',
      expect.objectContaining({ fsPath: sourceDirectory }),
    );
    expect(harness.workspaceTargetResults().map(({ outcome }) => outcome)).toEqual([
      'opened',
      'opened',
    ]);
    await rm(root, { force: true, recursive: true });
  });

  it('reports missing targets and ignores duplicate or disposed-view requests', async () => {
    const root = await createTemporaryWorkspace();
    const harness = createHarness({ rootPath: root });
    const firstView = harness.resolve();
    firstView.receive({ type: 'openWorkspaceTarget', requestId: 0, path: 'missing.ts' });
    await harness.waitForWorkspaceTargetResultCount(1);
    firstView.receive({ type: 'openWorkspaceTarget', requestId: 0, path: 'other.ts' });
    harness.disposeView();
    firstView.receive({ type: 'openWorkspaceTarget', requestId: 1, path: 'other.ts' });
    await Promise.resolve();

    expect(harness.workspaceTargetResults()).toEqual([
      expect.objectContaining({ requestId: 0, path: 'missing.ts', outcome: 'missing' }),
    ]);
    await rm(root, { force: true, recursive: true });
  });

  it('does not open a target after the active workspace changes', async () => {
    const root = await createTemporaryWorkspace();
    const sourceFile = join(root, 'index.ts');
    await writeFile(sourceFile, 'export {};');
    let currentRoot = root;
    const harness = createHarness({ getRootPath: () => currentRoot });
    harness.resolve();
    currentRoot = join(root, 'replacement');
    harness.receive({ type: 'openWorkspaceTarget', requestId: 0, path: 'index.ts' });
    await Promise.resolve();

    expect(vscode.workspace.openTextDocument).not.toHaveBeenCalled();
    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
    await rm(root, { force: true, recursive: true });
  });

  it('publishes bounded entity details for the requested analysis version', async () => {
    const service = createService({
      currentVersion: 3,
      entity: {
        id: 'entity-1',
        kind: 'file',
        name: 'Repository service',
        path: 'src/service.ts',
        purpose: 'Coordinates repository access',
        architectureRole: 'service',
        businessDomain: 'repositories',
        importance: 0.9,
        criticality: 'high',
        complexity: 8,
        healthScore: 0.85,
        risks: Array.from({ length: 110 }, (_, index) => `risk-${index}`),
        dependsOn: Array.from({ length: 110 }, (_, index) => `dependency-${index}`),
        dependedOnBy: ['consumer-1'],
        belongsToDomain: null,
        belongsToLayer: null,
        knowledgeNodeIds: ['knowledge-1'],
        knowledgeDensity: 0.8,
        confidence: 0.9,
        lastAnalyzedAt: 1,
      },
    });
    const harness = createHarness({ service });
    harness.resolve();
    harness.receive({
      type: 'requestEntityDetail',
      requestId: 4,
      analysisVersion: 3,
      entityId: 'entity-1',
    });
    await harness.waitForEntityDetailCount(1);

    const [detail] = harness.entityDetails();
    expect(detail).toEqual(
      expect.objectContaining({
        requestId: 4,
        analysisVersion: 3,
        entityId: 'entity-1',
        entity: expect.objectContaining({ path: 'src/service.ts' }),
      }),
    );
    expect(detail?.entity?.dependencies).toHaveLength(100);
    expect(detail?.entity?.risks).toHaveLength(100);
  });

  it('rejects stale entity versions and ignores results after view disposal', async () => {
    const deferred = createDeferred<ReturnType<typeof Ok<never>>>();
    const service = createService({ currentVersion: 2 });
    service.getEntity = vi.fn(() => deferred.promise as never);
    const harness = createHarness({ service });
    harness.resolve();
    harness.receive({
      type: 'requestEntityDetail',
      requestId: 0,
      analysisVersion: 1,
      entityId: 'stale',
    });
    await harness.waitForEntityDetailCount(1);
    expect(harness.entityDetails()[0]).toEqual(
      expect.objectContaining({ entity: null, error: 'Analysis version is no longer current.' }),
    );

    harness.receive({
      type: 'requestEntityDetail',
      requestId: 1,
      analysisVersion: 2,
      entityId: 'pending',
    });
    harness.disposeView();
    deferred.resolve(Ok(null) as never);
    await Promise.resolve();
    expect(harness.entityDetails()).toHaveLength(1);
  });

  it('publishes a deterministic bounded evolution comparison', async () => {
    const service = createService({ currentVersion: 4 });
    service.getDiff = vi.fn(async () =>
      Ok({
        fromVersion: 2,
        toVersion: 4,
        timestamp: 1,
        addedEntities: ['z', 'a'],
        removedEntities: ['y', 'b'],
        modifiedEntities: [
          { entityId: 'z', changes: [{ field: 'purpose', from: '', to: 'new' }] },
          { entityId: 'a', changes: [{ field: 'healthScore', from: 0, to: 1 }] },
        ],
        healthDelta: { overall: 4, dimensions: { risk: 2, architecture: 1 } },
        newRisks: ['risk-z', 'risk-a'],
        resolvedRisks: [],
        addedEdges: 2,
        removedEdges: 1,
        newDomains: ['sales'],
        removedDomains: [],
        architecturalSignificance: 0.4,
      }),
    );
    const harness = createHarness({ service });
    harness.resolve();
    harness.receive({
      type: 'requestEvolutionComparison',
      requestId: 2,
      analysisVersion: 4,
      fromVersion: 2,
      toVersion: 4,
    });
    await harness.waitForEvolutionComparisonCount(1);

    expect(harness.evolutionComparisons()[0]?.comparison).toEqual(
      expect.objectContaining({ addedEntities: ['a', 'z'], removedEntities: ['b', 'y'] }),
    );
    expect(
      harness
        .evolutionComparisons()[0]
        ?.comparison?.changedEntities.map(({ entityId }) => entityId),
    ).toEqual(['a', 'z']);
  });

  it('rejects same-version and stale evolution comparisons without querying diffs', async () => {
    const service = createService({ currentVersion: 4 });
    service.getDiff = vi.fn();
    const harness = createHarness({ service });
    harness.resolve();
    harness.receive({
      type: 'requestEvolutionComparison',
      requestId: 0,
      analysisVersion: 3,
      fromVersion: 2,
      toVersion: 4,
    });
    harness.receive({
      type: 'requestEvolutionComparison',
      requestId: 1,
      analysisVersion: 4,
      fromVersion: 4,
      toVersion: 4,
    });
    await harness.waitForEvolutionComparisonCount(2);
    expect(service.getDiff).not.toHaveBeenCalled();
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
    rootPath?: string;
    getRootPath?: () => string | undefined;
    service?: IProjectDNAService;
  } = {},
) {
  const service = options.service ?? createService();
  const messages: unknown[] = [];
  let receiveMessage: ((message: unknown) => void) | undefined;
  let disposeView: (() => void) | undefined;
  const postResults = [...(options.postResults ?? [])];
  const navigationPostResults = [...(options.navigationPostResults ?? [])];
  const provider = new SidebarProvider(
    { toString: () => 'extension-uri' } as never,
    service,
    options.getRootPath ?? (() => options.rootPath ?? 'C:/repo'),
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
    workspaceTargetResults() {
      return messages
        .map((message) => ExtensionMessageSchema.parse(message))
        .filter((message) => message.type === 'workspaceTargetResult');
    },
    entityDetails() {
      return messages
        .map((message) => ExtensionMessageSchema.parse(message))
        .filter((message) => message.type === 'entityDetail');
    },
    evolutionComparisons() {
      return messages
        .map((message) => ExtensionMessageSchema.parse(message))
        .filter((message) => message.type === 'evolutionComparison');
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
    async waitForWorkspaceTargetResultCount(count: number) {
      await vi.waitFor(() => expect(this.workspaceTargetResults()).toHaveLength(count));
    },
    async waitForEntityDetailCount(count: number) {
      await vi.waitFor(() => expect(this.entityDetails()).toHaveLength(count));
    },
    async waitForEvolutionComparisonCount(count: number) {
      await vi.waitFor(() => expect(this.evolutionComparisons()).toHaveLength(count));
    },
  };
}

function createService(options: { currentVersion?: number; entity?: unknown } = {}) {
  return {
    onProgress() {
      return () => undefined;
    },
    onReady() {
      return () => undefined;
    },
    getCurrent() {
      return Ok(options.currentVersion ? { version: options.currentVersion } : null);
    },
    async getEntity() {
      return Ok(options.entity ?? null);
    },
  } as unknown as IProjectDNAService;
}

async function createTemporaryWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'project-dna-sidebar-'));
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
