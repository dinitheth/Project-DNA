import * as vscode from 'vscode';
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import {
  WebviewMessageSchema,
  WorkspaceRelativePathSchema,
  isErr,
  type ExtensionMessage,
  type SidebarRoute,
  type WebviewMessage,
} from '@project-dna/shared';
import type { IProjectDNAService } from '@project-dna/dna-core';
import { buildSidebarData } from './sidebar-data.js';

export class SidebarProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private webviewView: vscode.WebviewView | undefined;
  private operation: Promise<void> | null = null;
  private publicationEpoch = 0;
  private analysisInProgress = false;
  private activeRootPath: string | null = null;
  private publicationOperation: Promise<void> | null = null;
  private publicationRequested = false;
  private currentRoute: SidebarRoute = 'overview';
  private navigationGeneration = 0;
  private navigationRevision = 0;
  private deliveredNavigationRevision = -1;
  private navigationRequestId: number | undefined;
  private lastClientRequestId = -1;
  private hasAuthoritativeNavigation = false;
  private webviewReady = false;
  private disposed = false;
  private readonly unsubscribeProgress: () => void;
  private readonly unsubscribeReady: () => void;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly service: IProjectDNAService,
    private readonly getWorkspaceRoot: () => string | undefined,
  ) {
    this.unsubscribeProgress = service.onProgress((progress) => {
      if (progress.stage === 'scanning' && !this.analysisInProgress) {
        const rootPath = this.getWorkspaceRoot();
        if (rootPath) {
          this.publicationEpoch++;
          this.analysisInProgress = true;
          this.activeRootPath = rootPath;
          void this.postMessage({ type: 'analysisStarted', rootPath });
        }
      }
      if (progress.stage === 'failed') {
        this.analysisInProgress = false;
        this.activeRootPath = null;
        void this.postMessage({ type: 'analysisError', message: progress.message });
        return;
      }
      if (progress.stage === 'complete') {
        this.analysisInProgress = false;
        this.activeRootPath = null;
        this.requestPublication();
        return;
      }
      void this.postMessage({
        type: 'analysisProgress',
        stage: progress.stage,
        message: progress.message,
        percent: progress.percent,
      });
    });
    this.unsubscribeReady = service.onReady(() => {
      this.analysisInProgress = false;
      this.activeRootPath = null;
      this.requestPublication();
    });
  }

  public handleWorkspaceChanged(rootPath: string | null): void {
    this.publicationEpoch++;
    this.analysisInProgress = false;
    this.activeRootPath = null;
    this.publicationRequested = false;
    void this.postMessage({ type: 'analysisUnavailable', rootPath });
  }

  public navigateTo(route: SidebarRoute): void {
    this.hasAuthoritativeNavigation = true;
    this.navigationRequestId = undefined;
    this.acceptNavigation(route);
    void this.deliverNavigation();
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.webviewView = webviewView;
    this.webviewReady = false;
    this.deliveredNavigationRevision = -1;
    this.lastClientRequestId = -1;
    webviewView.onDidDispose(() => {
      if (this.webviewView === webviewView) {
        this.webviewView = undefined;
        this.webviewReady = false;
      }
    });
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };
    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((candidate: unknown) => {
      if (this.webviewView !== webviewView) return;
      const parsed = WebviewMessageSchema.safeParse(candidate);
      if (!parsed.success) return;
      void this.handleMessage(parsed.data, webviewView);
    });
  }

  public dispose(): void {
    this.disposed = true;
    this.publicationEpoch++;
    this.unsubscribeProgress();
    this.unsubscribeReady();
    this.webviewView = undefined;
  }

  private async handleMessage(
    message: WebviewMessage,
    sourceView: vscode.WebviewView,
  ): Promise<void> {
    switch (message.type) {
      case 'ready':
        this.webviewReady = true;
        this.restoreOrReconcileNavigation(message.route, message.generation, message.revision);
        await this.deliverNavigation();
        await this.publishCurrentData();
        return;
      case 'requestRepositoryData':
      case 'requestArchitectureData':
      case 'requestDependencyData':
      case 'requestKnowledgeData':
        await this.publishCurrentData();
        return;
      case 'requestEntityDetail':
        await this.publishEntityDetail(
          sourceView,
          message.requestId,
          message.analysisVersion,
          message.entityId,
        );
        return;
      case 'requestAnalysis':
        await this.runExclusive(() => this.analyzeWorkspace());
        return;
      case 'requestRefresh':
        await this.runExclusive(() => this.refreshAnalysis());
        return;
      case 'openWorkspaceTarget':
        await this.openWorkspaceTarget(sourceView, message.requestId, message.path);
        return;
      case 'navigateTo':
        if (
          message.generation !== this.navigationGeneration ||
          message.revision !== this.navigationRevision ||
          message.requestId <= this.lastClientRequestId
        ) {
          return;
        }
        this.hasAuthoritativeNavigation = true;
        this.lastClientRequestId = message.requestId;
        this.navigationRequestId = message.requestId;
        this.acceptNavigation(message.route);
        await this.deliverNavigation();
        return;
      case 'updateSettings':
        await this.postMessage({
          type: 'analysisError',
          message: 'Project DNA settings are not configurable in this release.',
          stage: 'settings',
        });
        return;
    }
  }

  private async runExclusive(operation: () => Promise<void>): Promise<void> {
    if (this.operation) return this.operation;
    this.operation = operation().finally(() => {
      this.operation = null;
    });
    return this.operation;
  }

  private async analyzeWorkspace(): Promise<void> {
    const rootPath = this.getWorkspaceRoot();
    if (!rootPath) {
      await this.postMessage({
        type: 'analysisError',
        message: 'Open a workspace folder before running Project DNA analysis.',
        stage: 'workspace',
      });
      return;
    }

    await this.service.analyze(rootPath);
  }

  private async refreshAnalysis(): Promise<void> {
    const current = this.service.getCurrent();
    if (isErr(current)) {
      await this.postMessage({ type: 'analysisError', message: current.error.message });
      return;
    }
    if (!current.value) {
      await this.analyzeWorkspace();
      return;
    }

    await this.service.refresh();
  }

  private async openWorkspaceTarget(
    sourceView: vscode.WebviewView,
    requestId: number,
    candidatePath: string,
  ): Promise<void> {
    if (this.webviewView !== sourceView || this.disposed) return;
    const pathResult = WorkspaceRelativePathSchema.safeParse(candidatePath);
    if (!pathResult.success) return;
    const workspaceRoot = this.getWorkspaceRoot();
    if (!workspaceRoot) {
      await this.postWorkspaceTargetResult(
        sourceView,
        requestId,
        candidatePath,
        'rejected',
        'No workspace is open.',
      );
      return;
    }
    const targetPath = resolve(workspaceRoot, pathResult.data);
    if (!isPathInside(workspaceRoot, targetPath)) {
      await this.postWorkspaceTargetResult(
        sourceView,
        requestId,
        pathResult.data,
        'rejected',
        'Target is outside the workspace.',
      );
      return;
    }
    try {
      const targetStat = await stat(targetPath);
      const [canonicalRoot, canonicalTarget] = await Promise.all([
        realpath(workspaceRoot),
        realpath(targetPath),
      ]);
      if (
        this.webviewView !== sourceView ||
        !samePath(this.getWorkspaceRoot() ?? '', workspaceRoot) ||
        !isPathInside(canonicalRoot, canonicalTarget)
      ) {
        if (this.webviewView === sourceView) {
          await this.postWorkspaceTargetResult(
            sourceView,
            requestId,
            pathResult.data,
            'rejected',
            'Target resolves outside the workspace.',
          );
        }
        return;
      }
      const targetUri = vscode.Uri.file(canonicalTarget);
      if (targetStat.isDirectory()) {
        await vscode.commands.executeCommand('revealInExplorer', targetUri);
      } else {
        const document = await vscode.workspace.openTextDocument(targetUri);
        if (
          this.webviewView !== sourceView ||
          !samePath(this.getWorkspaceRoot() ?? '', workspaceRoot)
        ) {
          return;
        }
        await vscode.window.showTextDocument(document, { preview: true });
      }
      await this.postWorkspaceTargetResult(sourceView, requestId, pathResult.data, 'opened');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const outcome = isFileNotFound(error) ? 'missing' : 'failed';
      await this.postWorkspaceTargetResult(
        sourceView,
        requestId,
        pathResult.data,
        outcome,
        message,
      );
    }
  }

  private async postWorkspaceTargetResult(
    sourceView: vscode.WebviewView,
    requestId: number,
    path: string,
    outcome: 'opened' | 'missing' | 'rejected' | 'failed',
    message?: string,
  ): Promise<void> {
    if (this.webviewView !== sourceView) return;
    await sourceView.webview.postMessage({
      type: 'workspaceTargetResult',
      requestId,
      path,
      outcome,
      message,
    });
  }

  private async publishCurrentData(): Promise<void> {
    if (this.analysisInProgress) {
      if (this.activeRootPath) {
        await this.postMessage({ type: 'analysisStarted', rootPath: this.activeRootPath });
      }
      return;
    }
    const publicationEpoch = this.publicationEpoch;
    const current = this.service.getCurrent();
    if (isErr(current)) {
      await this.postMessage({ type: 'analysisError', message: current.error.message });
      return;
    }
    if (!current.value) {
      await this.postMessage({
        type: 'analysisUnavailable',
        rootPath: this.getWorkspaceRoot() ?? null,
      });
      return;
    }
    const workspaceRoot = this.getWorkspaceRoot();
    if (!workspaceRoot || !samePath(current.value.rootPath, workspaceRoot)) {
      await this.postMessage({ type: 'analysisUnavailable', rootPath: workspaceRoot ?? null });
      return;
    }

    try {
      const data = await buildSidebarData(this.service);
      if (publicationEpoch !== this.publicationEpoch) return;
      const version = data.repository.version;
      await this.postMessage({ type: 'analysisSnapshot', version, data });
      await this.postMessage({
        type: 'analysisComplete',
        version,
        summary: {
          fileCount: data.repository.coverage.parsed,
          languageCount: data.repository.languages.length,
          architecturePattern: data.architecture.pattern,
          knowledgeNodeCount: data.repository.counts.knowledgeNodes,
          durationMs: data.repository.durationMs,
        },
      });
    } catch (error) {
      if (publicationEpoch !== this.publicationEpoch) return;
      await this.postMessage({
        type: 'analysisError',
        message: error instanceof Error ? error.message : String(error),
        stage: 'sidebar-data',
      });
    }
  }

  private async publishEntityDetail(
    sourceView: vscode.WebviewView,
    requestId: number,
    analysisVersion: number,
    entityId: string,
  ): Promise<void> {
    if (this.webviewView !== sourceView || this.disposed) return;
    const current = this.service.getCurrent();
    if (isErr(current) || !current.value || current.value.version !== analysisVersion) {
      await this.postEntityDetail(
        sourceView,
        requestId,
        analysisVersion,
        entityId,
        null,
        'Analysis version is no longer current.',
      );
      return;
    }
    const result = await this.service.getEntity(entityId);
    if (this.webviewView !== sourceView) return;
    if (isErr(result)) {
      await this.postEntityDetail(
        sourceView,
        requestId,
        analysisVersion,
        entityId,
        null,
        result.error.message,
      );
      return;
    }
    if (!result.value) {
      await this.postEntityDetail(
        sourceView,
        requestId,
        analysisVersion,
        entityId,
        null,
        'Entity not found.',
      );
      return;
    }
    await this.postEntityDetail(sourceView, requestId, analysisVersion, entityId, {
      id: result.value.id,
      name: result.value.name,
      kind: result.value.kind,
      path: result.value.path,
      purpose: result.value.purpose,
      role: result.value.architectureRole,
      domain: result.value.businessDomain,
      criticality: result.value.criticality,
      complexity: result.value.complexity,
      health: result.value.healthScore,
      dependencies: [...result.value.dependsOn].slice(0, 100),
      dependents: [...result.value.dependedOnBy].slice(0, 100),
      risks: [...result.value.risks].slice(0, 100),
      knowledgeReferences: [...result.value.knowledgeNodeIds].slice(0, 100),
    });
  }

  private async postEntityDetail(
    sourceView: vscode.WebviewView,
    requestId: number,
    analysisVersion: number,
    entityId: string,
    entity: import('@project-dna/shared').EntityDetailData | null,
    error?: string,
  ): Promise<void> {
    if (this.webviewView !== sourceView) return;
    await sourceView.webview.postMessage({
      type: 'entityDetail',
      requestId,
      analysisVersion,
      entityId,
      entity,
      error,
    });
  }

  private requestPublication(): void {
    if (this.disposed) return;
    this.publicationRequested = true;
    if (this.publicationOperation) return;
    this.publicationOperation = Promise.resolve()
      .then(async () => {
        while (this.publicationRequested && !this.disposed) {
          this.publicationRequested = false;
          await this.publishCurrentData();
        }
      })
      .finally(() => {
        this.publicationOperation = null;
        if (this.publicationRequested) this.requestPublication();
      });
  }

  private async postMessage(message: ExtensionMessage): Promise<boolean> {
    return (await this.webviewView?.webview.postMessage(message)) ?? false;
  }

  private acceptNavigation(route: SidebarRoute): void {
    this.currentRoute = route;
    if (this.navigationRevision === Number.MAX_SAFE_INTEGER) {
      if (this.navigationGeneration === Number.MAX_SAFE_INTEGER) {
        throw new Error('Sidebar navigation version space is exhausted.');
      }
      this.navigationGeneration++;
      this.navigationRevision = 0;
      this.deliveredNavigationRevision = -1;
      return;
    }
    this.navigationRevision++;
  }

  private restoreOrReconcileNavigation(
    route: SidebarRoute,
    generation: number,
    revision: number,
  ): void {
    if (!this.hasAuthoritativeNavigation) {
      this.currentRoute = route;
      this.navigationGeneration = generation;
      this.navigationRevision = revision;
      this.deliveredNavigationRevision = revision;
      return;
    }
    if (
      route === this.currentRoute &&
      generation === this.navigationGeneration &&
      revision === this.navigationRevision
    ) {
      this.deliveredNavigationRevision = revision;
      return;
    }
    if (
      isNewerNavigationVersion(
        generation,
        revision,
        this.navigationGeneration,
        this.navigationRevision,
      )
    ) {
      this.navigationGeneration = generation;
      this.navigationRevision = revision;
      this.acceptNavigation(this.currentRoute);
    }
  }

  private async deliverNavigation(): Promise<void> {
    if (
      !this.webviewReady ||
      !this.webviewView ||
      this.deliveredNavigationRevision >= this.navigationRevision
    ) {
      return;
    }
    const target = this.webviewView;
    const generation = this.navigationGeneration;
    const revision = this.navigationRevision;
    const delivered = await target.webview.postMessage({
      type: 'navigateTo',
      route: this.currentRoute,
      generation,
      revision,
      requestId: this.navigationRequestId,
    });
    if (
      delivered &&
      this.webviewView === target &&
      this.navigationGeneration === generation &&
      this.navigationRevision === revision &&
      revision > this.deliveredNavigationRevision
    ) {
      this.deliveredNavigationRevision = revision;
    }
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'assets', 'index.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'assets', 'index.css'),
    );
    const nonce = getNonce();

    return `<!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link href="${styleUri}" rel="stylesheet">
        <title>Project DNA</title>
      </head>
      <body>
        <div id="root"></div>
        <script nonce="${nonce}" src="${scriptUri}"></script>
      </body>
      </html>`;
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

function samePath(left: string, right: string): boolean {
  const normalize = (value: string) => value.replaceAll('\\', '/').replace(/\/+$/u, '');
  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

export function isPathInside(workspaceRoot: string, targetPath: string): boolean {
  const root = resolve(workspaceRoot);
  const relativePath = relative(root, resolve(targetPath));
  return (
    relativePath === '' ||
    (relativePath !== '..' && !isAbsolute(relativePath) && !relativePath.startsWith(`..${sep}`))
  );
}

function isFileNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}

function isNewerNavigationVersion(
  generation: number,
  revision: number,
  currentGeneration: number,
  currentRevision: number,
): boolean {
  return (
    generation > currentGeneration ||
    (generation === currentGeneration && revision > currentRevision)
  );
}
