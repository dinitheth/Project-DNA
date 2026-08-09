import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DNAEventNames,
  EventBus,
  type DNAEventMap,
  type RepositoryFilesChangedPayload,
  type RepositoryWatcherInvalidatedPayload,
} from '@project-dna/shared';

interface FakeWatcher {
  readonly createListeners: Array<(uri: { fsPath: string }) => void>;
  readonly changeListeners: Array<(uri: { fsPath: string }) => void>;
  readonly deleteListeners: Array<(uri: { fsPath: string }) => void>;
  disposed: boolean;
}

const vscodeState = vi.hoisted(() => ({
  workspaceFolders: [] as Array<{
    uri: { fsPath: string };
  }>,
  workspaceListener: null as (() => void) | null,
  watchers: [] as FakeWatcher[],
}));

vi.mock('vscode', () => ({
  RelativePattern: class RelativePattern {
    constructor(
      readonly base: string,
      readonly pattern: string,
    ) {}
  },
  workspace: {
    get workspaceFolders() {
      return vscodeState.workspaceFolders;
    },
    onDidChangeWorkspaceFolders(listener: () => void) {
      vscodeState.workspaceListener = listener;
      return { dispose: () => (vscodeState.workspaceListener = null) };
    },
    createFileSystemWatcher() {
      const watcher: FakeWatcher & {
        onDidCreate(listener: (uri: { fsPath: string }) => void): { dispose(): void };
        onDidChange(listener: (uri: { fsPath: string }) => void): { dispose(): void };
        onDidDelete(listener: (uri: { fsPath: string }) => void): { dispose(): void };
        dispose(): void;
      } = {
        createListeners: [],
        changeListeners: [],
        deleteListeners: [],
        disposed: false,
        onDidCreate(listener) {
          this.createListeners.push(listener);
          return { dispose() {} };
        },
        onDidChange(listener) {
          this.changeListeners.push(listener);
          return { dispose() {} };
        },
        onDidDelete(listener) {
          this.deleteListeners.push(listener);
          return { dispose() {} };
        },
        dispose() {
          this.disposed = true;
        },
      };
      vscodeState.watchers.push(watcher);
      return watcher;
    },
  },
}));

import { RepositoryWatcher } from '../repository-watcher.js';

const repositoryA = path.resolve(path.parse(process.cwd()).root, 'repo-a');
const repositoryB = path.resolve(path.parse(process.cwd()).root, 'repo-b');
const normalizedRepositoryA = normalizeFixturePath(repositoryA);
const normalizedRepositoryB = normalizeFixturePath(repositoryB);

describe('RepositoryWatcher', () => {
  beforeEach(() => {
    vscodeState.workspaceFolders = [{ uri: { fsPath: repositoryA } }];
    vscodeState.workspaceListener = null;
    vscodeState.watchers = [];
  });

  it('normalizes, deduplicates, and deterministically publishes burst changes', async () => {
    const eventBus = new EventBus<DNAEventMap>();
    const published: RepositoryFilesChangedPayload[] = [];
    eventBus.on(DNAEventNames.RepositoryFilesChanged, (payload) => published.push(payload));
    const repositoryWatcher = new RepositoryWatcher(eventBus, () => undefined);
    const watcher = currentWatcher();

    const sourceA = path.join(repositoryA, 'src', 'a.ts');
    const sourceZ = path.join(repositoryA, 'src', 'z.ts');
    emit(watcher.createListeners, sourceZ);
    emit(watcher.changeListeners, sourceZ);
    emit(watcher.changeListeners, sourceA);
    await flushMicrotasks();

    expect(published).toHaveLength(1);
    expect(published[0]?.watcherEpoch).toBe(1);
    expect(published[0]?.sequence).toBe(1);
    expect(published[0]?.changes).toEqual([
      { kind: 'modified', path: normalizeFixturePath(sourceA) },
      { kind: 'created', path: normalizeFixturePath(sourceZ) },
    ]);

    emit(watcher.deleteListeners, sourceZ);
    emit(watcher.createListeners, sourceZ);
    await flushMicrotasks();
    expect(published[1]?.changes).toEqual([
      { kind: 'modified', path: normalizeFixturePath(sourceZ) },
    ]);
    repositoryWatcher.dispose();
  });

  it('replaces the watcher and invalidates the baseline on workspace switch or restart', () => {
    const eventBus = new EventBus<DNAEventMap>();
    const invalidations: RepositoryWatcherInvalidatedPayload[] = [];
    const workspaces: Array<string | null> = [];
    eventBus.on(DNAEventNames.RepositoryWatcherInvalidated, (payload) =>
      invalidations.push(payload),
    );
    const repositoryWatcher = new RepositoryWatcher(eventBus, (rootPath) =>
      workspaces.push(rootPath),
    );
    const initialWatcher = currentWatcher();

    vscodeState.workspaceFolders = [{ uri: { fsPath: repositoryB } }];
    vscodeState.workspaceListener?.();
    expect(initialWatcher.disposed).toBe(true);
    expect(invalidations[0]).toMatchObject({
      rootPath: normalizedRepositoryB,
      watcherEpoch: 2,
      reason: 'workspace-change',
    });

    const secondWatcher = currentWatcher();
    vscodeState.workspaceListener?.();
    expect(secondWatcher.disposed).toBe(true);
    expect(invalidations[1]).toMatchObject({
      rootPath: normalizedRepositoryB,
      watcherEpoch: 3,
      reason: 'restart',
    });

    vscodeState.workspaceFolders = [];
    vscodeState.workspaceListener?.();
    expect(currentWatcher().disposed).toBe(true);
    expect(workspaces).toEqual([normalizedRepositoryB, normalizedRepositoryB, null]);
    repositoryWatcher.dispose();
  });

  it('recovers from an internal queue overflow with a new watcher epoch', async () => {
    const eventBus = new EventBus<DNAEventMap>();
    const invalidations: RepositoryWatcherInvalidatedPayload[] = [];
    eventBus.on(DNAEventNames.RepositoryWatcherInvalidated, (payload) =>
      invalidations.push(payload),
    );
    const repositoryWatcher = new RepositoryWatcher(eventBus, () => undefined);
    const initialWatcher = currentWatcher();

    for (let index = 0; index <= 10_000; index++) {
      emit(initialWatcher.changeListeners, path.join(repositoryA, 'src', `file-${index}.ts`));
    }
    await flushMicrotasks();

    expect(initialWatcher.disposed).toBe(true);
    expect(invalidations).toHaveLength(1);
    expect(invalidations[0]).toMatchObject({
      rootPath: normalizedRepositoryA,
      watcherEpoch: 2,
      reason: 'overflow',
    });
    expect(vscodeState.watchers).toHaveLength(2);
    repositoryWatcher.dispose();
  });
});

function currentWatcher(): FakeWatcher {
  const watcher = vscodeState.watchers.at(-1);
  if (!watcher) throw new Error('Expected an active filesystem watcher');
  return watcher;
}

function emit(listeners: Array<(uri: { fsPath: string }) => void>, fsPath: string): void {
  for (const listener of listeners) listener({ fsPath });
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function normalizeFixturePath(filePath: string): string {
  return filePath.replaceAll('\\', '/').replace(/\/+$/u, '');
}
