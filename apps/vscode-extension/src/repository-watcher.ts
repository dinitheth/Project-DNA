import path from 'node:path';
import * as vscode from 'vscode';
import {
  DNAEventNames,
  type DNAEventMap,
  type EventBus,
  type RepositoryFileChange,
  type RepositoryFileChangeKind,
} from '@project-dna/shared';

const MAX_PENDING_CHANGES = 10_000;

/** Owns the single VS Code filesystem watcher for the active workspace folder. */
export class RepositoryWatcher implements vscode.Disposable {
  private watcher: vscode.FileSystemWatcher | null = null;
  private readonly pendingChanges = new Map<string, RepositoryFileChange>();
  private readonly workspaceSubscription: vscode.Disposable;
  private rootPath: string | null = null;
  private watcherEpoch = 0;
  private sequence = 0;
  private flushScheduled = false;
  private disposed = false;

  constructor(
    private readonly eventBus: EventBus<DNAEventMap>,
    private readonly onWorkspaceChanged: (rootPath: string | null) => void,
  ) {
    this.workspaceSubscription = vscode.workspace.onDidChangeWorkspaceFolders(() => {
      this.replaceWorkspace(firstWorkspaceRoot(), true);
    });
    this.replaceWorkspace(firstWorkspaceRoot(), false);
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.workspaceSubscription.dispose();
    this.watcher?.dispose();
    this.watcher = null;
    this.pendingChanges.clear();
  }

  private replaceWorkspace(nextRootPath: string | null, notify: boolean): void {
    const normalizedNext = nextRootPath ? normalizeAbsolutePath(nextRootPath) : null;
    const previousRoot = this.rootPath;
    const sameRoot =
      previousRoot !== null && normalizedNext !== null && previousRoot === normalizedNext;

    this.watcher?.dispose();
    this.watcher = null;
    this.pendingChanges.clear();
    this.flushScheduled = false;
    this.rootPath = normalizedNext;
    this.watcherEpoch++;
    this.sequence = 0;

    if (normalizedNext) this.watcher = this.createWatcher(normalizedNext, this.watcherEpoch);
    if (!notify) return;

    this.onWorkspaceChanged(normalizedNext);
    if (!normalizedNext) return;
    this.eventBus.emit(DNAEventNames.RepositoryWatcherInvalidated, {
      rootPath: normalizedNext,
      watcherEpoch: this.watcherEpoch,
      observedAt: Date.now(),
      reason: sameRoot ? 'restart' : 'workspace-change',
    });
  }

  private createWatcher(rootPath: string, watcherEpoch: number): vscode.FileSystemWatcher {
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(rootPath, '**/*'),
    );
    watcher.onDidCreate((uri) => this.queueChange('created', uri, rootPath, watcherEpoch));
    watcher.onDidChange((uri) => this.queueChange('modified', uri, rootPath, watcherEpoch));
    watcher.onDidDelete((uri) => this.queueChange('deleted', uri, rootPath, watcherEpoch));
    return watcher;
  }

  private queueChange(
    kind: RepositoryFileChangeKind,
    uri: vscode.Uri,
    rootPath: string,
    watcherEpoch: number,
  ): void {
    if (this.disposed || watcherEpoch !== this.watcherEpoch || rootPath !== this.rootPath) return;
    const filePath = normalizeAbsolutePath(uri.fsPath);
    if (!isPathWithinRoot(rootPath, filePath)) return;
    const key = comparisonPath(filePath);
    const previous = this.pendingChanges.get(key);
    const mergedKind = mergeChangeKinds(previous?.kind, kind);
    if (mergedKind) this.pendingChanges.set(key, { kind: mergedKind, path: filePath });
    else this.pendingChanges.delete(key);

    if (this.pendingChanges.size > MAX_PENDING_CHANGES) {
      this.invalidateForOverflow(rootPath);
      return;
    }
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    queueMicrotask(() => this.flushChanges(watcherEpoch, rootPath));
  }

  private flushChanges(watcherEpoch: number, rootPath: string): void {
    this.flushScheduled = false;
    if (this.disposed || watcherEpoch !== this.watcherEpoch || rootPath !== this.rootPath) return;
    if (this.pendingChanges.size === 0) return;
    const changes = [...this.pendingChanges.values()].sort((left, right) =>
      left.path.localeCompare(right.path),
    );
    this.pendingChanges.clear();
    this.sequence++;
    this.eventBus.emit(DNAEventNames.RepositoryFilesChanged, {
      rootPath,
      watcherEpoch,
      sequence: this.sequence,
      observedAt: Date.now(),
      changes,
    });
  }

  private invalidateForOverflow(rootPath: string): void {
    this.pendingChanges.clear();
    this.flushScheduled = false;
    this.watcher?.dispose();
    this.watcherEpoch++;
    this.sequence = 0;
    this.watcher = this.createWatcher(rootPath, this.watcherEpoch);
    this.eventBus.emit(DNAEventNames.RepositoryWatcherInvalidated, {
      rootPath,
      watcherEpoch: this.watcherEpoch,
      observedAt: Date.now(),
      reason: 'overflow',
    });
  }
}

function firstWorkspaceRoot(): string | null {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
}

function mergeChangeKinds(
  previous: RepositoryFileChangeKind | undefined,
  next: RepositoryFileChangeKind,
): RepositoryFileChangeKind | null {
  if (!previous) return next;
  if (previous === 'created') return next === 'deleted' ? null : 'created';
  if (previous === 'deleted') return next === 'deleted' ? 'deleted' : 'modified';
  return next === 'deleted' ? 'deleted' : 'modified';
}

function normalizeAbsolutePath(filePath: string): string {
  return path.resolve(filePath).replaceAll('\\', '/').replace(/\/+$/u, '');
}

function comparisonPath(filePath: string): string {
  const normalized = normalizeAbsolutePath(filePath);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isPathWithinRoot(rootPath: string, filePath: string): boolean {
  const root = comparisonPath(rootPath);
  const candidate = comparisonPath(filePath);
  return candidate === root || candidate.startsWith(`${root}/`);
}
