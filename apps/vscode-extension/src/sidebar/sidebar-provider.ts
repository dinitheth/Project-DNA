import * as vscode from 'vscode';
import {
  WebviewMessageSchema,
  isErr,
  type ExtensionMessage,
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

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.webviewView = webviewView;
    webviewView.onDidDispose(() => {
      if (this.webviewView === webviewView) this.webviewView = undefined;
    });
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };
    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((candidate: unknown) => {
      const parsed = WebviewMessageSchema.safeParse(candidate);
      if (!parsed.success) return;
      void this.handleMessage(parsed.data);
    });
  }

  public dispose(): void {
    this.disposed = true;
    this.publicationEpoch++;
    this.unsubscribeProgress();
    this.unsubscribeReady();
    this.webviewView = undefined;
  }

  private async handleMessage(message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
      case 'requestRepositoryData':
      case 'requestArchitectureData':
      case 'requestDependencyData':
      case 'requestKnowledgeData':
        await this.publishCurrentData();
        return;
      case 'requestAnalysis':
        await this.runExclusive(() => this.analyzeWorkspace());
        return;
      case 'requestRefresh':
        await this.runExclusive(() => this.refreshAnalysis());
        return;
      case 'navigateTo':
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
