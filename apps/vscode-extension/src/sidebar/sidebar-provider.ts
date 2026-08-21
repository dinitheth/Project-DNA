import * as vscode from 'vscode';
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import {
  WebviewMessageSchema,
  WorkspaceRelativePathSchema,
  ImpactResultDataSchema,
  CommitImpactDataSchema,
  PullRequestImpactDataSchema,
  WorkingTreeImpactDataSchema,
  isErr,
  type ExtensionMessage,
  type SidebarRoute,
  type WebviewMessage,
  type WorkingTreeUnresolvedPathData,
} from '@project-dna/shared';
import {
  CommitGitError,
  GitCommitMetadataProvider,
  type IProjectDNAService,
} from '@project-dna/dna-core';
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
  private activeImpact:
    | {
        readonly view: vscode.WebviewView;
        readonly requestId: number;
        readonly controller: AbortController;
      }
    | undefined;
  private activeWorkingTreeImpact:
    | {
        readonly view: vscode.WebviewView;
        readonly requestId: number;
        readonly controller: AbortController;
      }
    | undefined;
  private activeCommitImpact:
    | {
        readonly view: vscode.WebviewView;
        readonly requestId: number;
        readonly commitSha: string;
        readonly selectedParentSha: string | null;
        readonly controller: AbortController;
      }
    | undefined;
  private activePullRequestImpact:
    | {
        readonly view: vscode.WebviewView;
        readonly requestId: number;
        readonly baseSha: string;
        readonly headSha: string;
        readonly controller: AbortController;
      }
    | undefined;
  private readonly unsubscribeProgress: () => void;
  private readonly unsubscribeReady: () => void;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly service: IProjectDNAService,
    private readonly getWorkspaceRoot: () => string | undefined,
    private readonly commitMetadataProvider: Pick<
      GitCommitMetadataProvider,
      'getCommitParents'
    > = new GitCommitMetadataProvider(),
  ) {
    this.unsubscribeProgress = service.onProgress((progress) => {
      if (progress.stage === 'scanning' && !this.analysisInProgress) {
        this.cancelActiveImpact();
        this.cancelActiveWorkingTreeImpact();
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
    this.cancelActiveImpact();
    this.cancelActiveWorkingTreeImpact();
    this.cancelActiveCommitImpact();
    this.cancelActivePullRequestImpact();
    this.cancelActivePullRequestImpact();
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
    this.cancelActiveImpact();
    this.cancelActiveWorkingTreeImpact();
    this.cancelActiveCommitImpact();
    this.webviewView = webviewView;
    this.webviewReady = false;
    this.deliveredNavigationRevision = -1;
    this.lastClientRequestId = -1;
    webviewView.onDidDispose(() => {
      if (this.webviewView === webviewView) {
        this.cancelActiveImpact();
        this.cancelActiveWorkingTreeImpact();
        this.cancelActiveCommitImpact();
        this.cancelActivePullRequestImpact();
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
    this.cancelActiveImpact();
    this.cancelActiveWorkingTreeImpact();
    this.cancelActiveCommitImpact();
    this.cancelActivePullRequestImpact();
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
      case 'requestEvolutionComparison':
        await this.publishEvolutionComparison(
          sourceView,
          message.requestId,
          message.analysisVersion,
          message.fromVersion,
          message.toVersion,
        );
        return;
      case 'requestImpact':
        await this.publishImpact(
          sourceView,
          message.requestId,
          message.analysisVersion,
          message.target,
        );
        return;
      case 'requestWorkingTreeImpact':
        await this.publishWorkingTreeImpact(sourceView, message.requestId, message.analysisVersion);
        return;
      case 'requestCommitImpact':
        await this.publishCommitImpact(
          sourceView,
          message.requestId,
          message.commitSha,
          message.selectedParentSha ?? null,
        );
        return;
      case 'requestPullRequestImpact':
        await this.publishPullRequestImpact(
          sourceView,
          message.requestId,
          message.baseSha,
          message.headSha,
        );
        return;
      case 'cancelImpact':
        if (
          this.activeImpact?.view === sourceView &&
          this.activeImpact.requestId === message.requestId
        ) {
          this.cancelActiveImpact();
        }
        return;
      case 'cancelWorkingTreeImpact':
        if (
          this.activeWorkingTreeImpact?.view === sourceView &&
          this.activeWorkingTreeImpact.requestId === message.requestId
        ) {
          this.cancelActiveWorkingTreeImpact();
        }
        return;
      case 'cancelCommitImpact':
        if (
          this.activeCommitImpact?.view === sourceView &&
          this.activeCommitImpact.requestId === message.requestId
        ) {
          this.cancelActiveCommitImpact();
        }
        return;
      case 'cancelPullRequestImpact':
        if (
          this.activePullRequestImpact?.view === sourceView &&
          this.activePullRequestImpact.requestId === message.requestId
        ) {
          this.cancelActivePullRequestImpact();
        }
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
    await safePostMessage(sourceView, {
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
    await safePostMessage(sourceView, {
      type: 'entityDetail',
      requestId,
      analysisVersion,
      entityId,
      entity,
      error,
    });
  }

  private async publishEvolutionComparison(
    sourceView: vscode.WebviewView,
    requestId: number,
    analysisVersion: number,
    fromVersion: number,
    toVersion: number,
  ): Promise<void> {
    if (this.webviewView !== sourceView || this.disposed) return;
    const current = this.service.getCurrent();
    if (
      fromVersion >= toVersion ||
      isErr(current) ||
      !current.value ||
      current.value.version !== analysisVersion
    ) {
      await this.postEvolutionComparison(
        sourceView,
        requestId,
        analysisVersion,
        fromVersion,
        toVersion,
        null,
        'Invalid or stale comparison selection.',
      );
      return;
    }
    const result = await this.service.getDiff(fromVersion, toVersion);
    if (this.webviewView !== sourceView) return;
    if (isErr(result)) {
      await this.postEvolutionComparison(
        sourceView,
        requestId,
        analysisVersion,
        fromVersion,
        toVersion,
        null,
        result.error.message,
      );
      return;
    }
    const diff = result.value;
    await this.postEvolutionComparison(
      sourceView,
      requestId,
      analysisVersion,
      fromVersion,
      toVersion,
      {
        fromVersion,
        toVersion,
        addedEntities: [...diff.addedEntities].sort().slice(0, 100),
        removedEntities: [...diff.removedEntities].sort().slice(0, 100),
        changedEntities: [...diff.modifiedEntities]
          .sort((left, right) => left.entityId.localeCompare(right.entityId))
          .slice(0, 100)
          .map((item) => ({
            entityId: item.entityId,
            fields: item.changes
              .map(({ field }) => field)
              .sort()
              .slice(0, 50),
          })),
        healthDelta: {
          overall: diff.healthDelta.overall,
          dimensions: Object.fromEntries(Object.entries(diff.healthDelta.dimensions).sort()),
        },
        newRisks: [...diff.newRisks].sort().slice(0, 100),
        resolvedRisks: [...diff.resolvedRisks].sort().slice(0, 100),
        addedEdges: diff.addedEdges,
        removedEdges: diff.removedEdges,
        newDomains: [...diff.newDomains].sort().slice(0, 100),
        removedDomains: [...diff.removedDomains].sort().slice(0, 100),
        architecturalSignificance: diff.architecturalSignificance,
      },
    );
  }

  private async postEvolutionComparison(
    sourceView: vscode.WebviewView,
    requestId: number,
    analysisVersion: number,
    fromVersion: number,
    toVersion: number,
    comparison: import('@project-dna/shared').EvolutionComparisonData | null,
    error?: string,
  ): Promise<void> {
    if (this.webviewView !== sourceView) return;
    await safePostMessage(sourceView, {
      type: 'evolutionComparison',
      requestId,
      analysisVersion,
      fromVersion,
      toVersion,
      comparison,
      error,
    });
  }

  private async publishImpact(
    sourceView: vscode.WebviewView,
    requestId: number,
    analysisVersion: number,
    target: import('@project-dna/shared').ImpactTargetData,
  ): Promise<void> {
    if (this.webviewView !== sourceView || this.disposed) return;
    this.cancelActiveImpact();
    const current = this.service.getCurrent();
    if (isErr(current) || !current.value || current.value.version !== analysisVersion) {
      await this.postImpact(
        sourceView,
        requestId,
        analysisVersion,
        target,
        null,
        'Analysis version is no longer current.',
      );
      return;
    }

    const controller = new AbortController();
    const operation = { view: sourceView, requestId, controller };
    this.activeImpact = operation;
    const result = await this.service.getImpact(target, undefined, controller.signal);
    if (this.activeImpact !== operation || this.webviewView !== sourceView || this.disposed) return;
    this.activeImpact = undefined;
    if (isErr(result)) {
      await this.postImpact(
        sourceView,
        requestId,
        analysisVersion,
        target,
        null,
        result.error.message,
      );
      return;
    }
    if (result.value.analysisVersion !== analysisVersion) {
      await this.postImpact(
        sourceView,
        requestId,
        analysisVersion,
        target,
        null,
        'Impact result was superseded by a newer analysis.',
      );
      return;
    }
    const serialized = ImpactResultDataSchema.safeParse(toImpactResultData(result.value));
    if (!serialized.success) {
      await this.postImpact(
        sourceView,
        requestId,
        analysisVersion,
        target,
        null,
        `Impact result could not cross the webview boundary: ${serialized.error.message}`,
      );
      return;
    }
    await this.postImpact(sourceView, requestId, analysisVersion, target, serialized.data);
  }

  private async postImpact(
    sourceView: vscode.WebviewView,
    requestId: number,
    analysisVersion: number,
    target: import('@project-dna/shared').ImpactTargetData,
    result: import('@project-dna/shared').ImpactResultData | null,
    error?: string,
  ): Promise<void> {
    if (this.webviewView !== sourceView) return;
    await safePostMessage(sourceView, {
      type: 'impactResult',
      requestId,
      analysisVersion,
      target,
      result,
      error,
    });
  }

  private async publishWorkingTreeImpact(
    sourceView: vscode.WebviewView,
    requestId: number,
    analysisVersion: number,
  ): Promise<void> {
    if (this.webviewView !== sourceView || this.disposed) return;
    this.cancelActiveWorkingTreeImpact();
    const current = this.service.getCurrent();
    if (isErr(current) || !current.value || current.value.version !== analysisVersion) {
      await this.postWorkingTreeImpact(
        sourceView,
        requestId,
        analysisVersion,
        null,
        'Analysis version is no longer current.',
      );
      return;
    }

    const controller = new AbortController();
    const operation = { view: sourceView, requestId, controller };
    this.activeWorkingTreeImpact = operation;
    const result = await this.service.getWorkingTreeImpact(undefined, controller.signal);
    if (
      this.activeWorkingTreeImpact !== operation ||
      this.webviewView !== sourceView ||
      this.disposed
    ) {
      return;
    }
    this.activeWorkingTreeImpact = undefined;
    if (isErr(result)) {
      await this.postWorkingTreeImpact(
        sourceView,
        requestId,
        analysisVersion,
        null,
        result.error.message,
      );
      return;
    }
    if (
      result.value.afterAnalysisVersion !== null &&
      result.value.afterAnalysisVersion !== analysisVersion
    ) {
      await this.postWorkingTreeImpact(
        sourceView,
        requestId,
        analysisVersion,
        null,
        'Working-tree impact was superseded by a newer analysis.',
      );
      return;
    }
    const serialized = WorkingTreeImpactDataSchema.safeParse(toWorkingTreeImpactData(result.value));
    if (!serialized.success) {
      await this.postWorkingTreeImpact(
        sourceView,
        requestId,
        analysisVersion,
        null,
        `Working-tree impact could not cross the webview boundary: ${serialized.error.message}`,
      );
      return;
    }
    await this.postWorkingTreeImpact(sourceView, requestId, analysisVersion, serialized.data);
  }

  private async postWorkingTreeImpact(
    sourceView: vscode.WebviewView,
    requestId: number,
    analysisVersion: number,
    result: import('@project-dna/shared').WorkingTreeImpactData | null,
    error?: string,
  ): Promise<void> {
    if (this.webviewView !== sourceView) return;
    await safePostMessage(sourceView, {
      type: 'workingTreeImpactResult',
      requestId,
      analysisVersion,
      result,
      error,
    });
  }

  private async publishCommitImpact(
    sourceView: vscode.WebviewView,
    requestId: number,
    commitSha: string,
    selectedParentSha: string | null,
  ): Promise<void> {
    if (this.webviewView !== sourceView || this.disposed) return;
    this.cancelActiveCommitImpact();
    const current = this.service.getCurrent();
    const repositoryId = !isErr(current) && current.value ? current.value.id : null;
    const repositoryRoot = this.getWorkspaceRoot();
    if (!repositoryId || !repositoryRoot) {
      await this.postCommitImpact(
        sourceView,
        requestId,
        repositoryId,
        commitSha,
        selectedParentSha,
        [],
        false,
        null,
        'No Project DNA repository is currently loaded.',
      );
      return;
    }

    const controller = new AbortController();
    const operation = {
      view: sourceView,
      requestId,
      commitSha,
      selectedParentSha,
      controller,
    };
    this.activeCommitImpact = operation;
    const result = await this.service.getCommitImpact(
      {
        commitSha,
        ...(selectedParentSha ? { parentSha: selectedParentSha } : {}),
      },
      undefined,
      controller.signal,
    );
    if (!this.isActiveCommitOperation(operation)) return;
    if (isErr(result)) {
      if (
        result.error instanceof CommitGitError &&
        result.error.code === 'ambiguous-merge-parent'
      ) {
        const parents = await this.commitMetadataProvider.getCommitParents(
          repositoryRoot,
          commitSha,
          controller.signal,
        );
        if (!this.isActiveCommitOperation(operation)) return;
        this.activeCommitImpact = undefined;
        if (isErr(parents)) {
          await this.postCommitImpact(
            sourceView,
            requestId,
            repositoryId,
            commitSha,
            selectedParentSha,
            [],
            false,
            null,
            parents.error.message,
          );
          return;
        }
        await this.postCommitImpact(
          sourceView,
          requestId,
          repositoryId,
          commitSha,
          null,
          [...parents.value],
          true,
          null,
        );
        return;
      }
      this.activeCommitImpact = undefined;
      await this.postCommitImpact(
        sourceView,
        requestId,
        repositoryId,
        commitSha,
        selectedParentSha,
        [],
        false,
        null,
        result.error.message,
      );
      return;
    }
    this.activeCommitImpact = undefined;
    const candidate = toCommitImpactData(result.value);
    const serialized = CommitImpactDataSchema.safeParse(candidate);
    if (!serialized.success) {
      await this.postCommitImpact(
        sourceView,
        requestId,
        repositoryId,
        commitSha,
        result.value.parentCommitSha,
        result.value.parentCommits,
        false,
        null,
        `Commit impact could not cross the webview boundary: ${serialized.error.message}`,
      );
      return;
    }
    await this.postCommitImpact(
      sourceView,
      requestId,
      repositoryId,
      commitSha,
      result.value.parentCommitSha,
      result.value.parentCommits,
      false,
      serialized.data,
    );
  }

  private isActiveCommitOperation(operation: NonNullable<SidebarProvider['activeCommitImpact']>) {
    return (
      this.activeCommitImpact === operation && this.webviewView === operation.view && !this.disposed
    );
  }

  private async publishPullRequestImpact(
    sourceView: vscode.WebviewView,
    requestId: number,
    baseSha: string,
    headSha: string,
  ): Promise<void> {
    if (this.webviewView !== sourceView || this.disposed) return;
    this.cancelActivePullRequestImpact();
    const current = this.service.getCurrent();
    const repositoryId = !isErr(current) && current.value ? current.value.id : null;
    const controller = new AbortController();
    const operation = { view: sourceView, requestId, baseSha, headSha, controller };
    this.activePullRequestImpact = operation;
    if (!repositoryId) {
      await this.postPullRequestImpact(
        sourceView,
        requestId,
        baseSha,
        headSha,
        null,
        null,
        'No Project DNA repository is currently loaded.',
      );
      return;
    }
    const result = await this.service.getPullRequestImpact(
      { baseSha, headSha },
      undefined,
      controller.signal,
    );
    if (!this.isActivePullRequestOperation(operation)) return;
    this.activePullRequestImpact = undefined;
    if (isErr(result)) {
      await this.postPullRequestImpact(
        sourceView,
        requestId,
        baseSha,
        headSha,
        null,
        null,
        result.error.message,
      );
      return;
    }
    const serialized = PullRequestImpactDataSchema.safeParse(toPullRequestImpactData(result.value));
    if (!serialized.success) {
      await this.postPullRequestImpact(
        sourceView,
        requestId,
        baseSha,
        headSha,
        result.value.mergeBaseSha,
        null,
        `PR impact could not cross the webview boundary: ${serialized.error.message}`,
      );
      return;
    }
    await this.postPullRequestImpact(
      sourceView,
      requestId,
      baseSha,
      headSha,
      serialized.data.mergeBaseSha,
      serialized.data,
    );
  }

  private isActivePullRequestOperation(
    operation: NonNullable<SidebarProvider['activePullRequestImpact']>,
  ) {
    return (
      this.activePullRequestImpact === operation &&
      this.webviewView === operation.view &&
      !this.disposed
    );
  }

  private async postCommitImpact(
    sourceView: vscode.WebviewView,
    requestId: number,
    repositoryId: string | null,
    commitSha: string,
    selectedParentSha: string | null,
    parentCommits: readonly string[],
    requiresParentSelection: boolean,
    result: import('@project-dna/shared').CommitImpactData | null,
    error?: string,
  ): Promise<void> {
    if (this.webviewView !== sourceView) return;
    await safePostMessage(sourceView, {
      type: 'commitImpactResult',
      requestId,
      repositoryId,
      commitSha,
      selectedParentSha,
      parentCommits: [...parentCommits],
      requiresParentSelection,
      result,
      error,
    });
  }

  private async postPullRequestImpact(
    sourceView: vscode.WebviewView,
    requestId: number,
    baseSha: string,
    headSha: string,
    mergeBaseSha: string | null,
    result: import('@project-dna/shared').PullRequestImpactData | null,
    error?: string,
  ): Promise<void> {
    if (this.webviewView !== sourceView) return;
    await safePostMessage(sourceView, {
      type: 'pullRequestImpactResult',
      requestId,
      baseSha,
      headSha,
      mergeBaseSha,
      result,
      error,
    });
  }

  private cancelActiveImpact(): void {
    this.activeImpact?.controller.abort();
    this.activeImpact = undefined;
  }

  private cancelActiveWorkingTreeImpact(): void {
    this.activeWorkingTreeImpact?.controller.abort();
    this.activeWorkingTreeImpact = undefined;
  }

  private cancelActiveCommitImpact(): void {
    this.activeCommitImpact?.controller.abort();
    this.activeCommitImpact = undefined;
  }

  private cancelActivePullRequestImpact(): void {
    this.activePullRequestImpact?.controller.abort();
    this.activePullRequestImpact = undefined;
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
    const delivered = await safePostNavigation(target, {
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

async function safePostNavigation(
  view: vscode.WebviewView,
  message: Extract<ExtensionMessage, { type: 'navigateTo' }>,
): Promise<boolean> {
  try {
    return await view.webview.postMessage(message);
  } catch {
    return false;
  }
}

async function safePostMessage(view: vscode.WebviewView, message: ExtensionMessage): Promise<void> {
  try {
    await view.webview.postMessage(message);
  } catch {
    // The webview may be disposed between the active-view check and delivery.
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

function toImpactResultData(
  result: import('@project-dna/dna-core').ImpactResult,
): import('@project-dna/shared').ImpactResultData {
  return {
    repositoryId: result.repositoryId,
    analysisVersion: result.analysisVersion,
    target: result.target,
    directImpactedEntities: result.directImpactedEntities,
    transitiveImpactedEntities: result.transitiveImpactedEntities,
    minimumDepth: result.minimumDepth,
    canonicalPaths: result.canonicalPaths,
    semanticEffects: {
      domains: result.semanticEffects.domains.map((domain) => ({
        id: domain.id,
        name: domain.name,
        confidence: domain.confidence,
        entityCount: domain.entityIds.length,
      })),
      capabilities: result.semanticEffects.capabilities.map((capability) => ({
        id: capability.id,
        name: capability.name,
        category: capability.category,
        description: capability.description,
        confidence: capability.confidence,
        implementationCount: capability.implementedBy.length,
      })),
      criticalComponents: result.semanticEffects.criticalComponents.map((component) => ({
        id: component.id,
        entityId: component.entityId,
        name: component.name,
        path: component.path,
        criticality: component.criticality,
        score: component.score,
        reason: component.reason,
      })),
      risks: result.semanticEffects.risks.map((risk) => ({
        id: risk.id,
        type: risk.type,
        severity: risk.severity,
        affectedEntityCount: risk.affectedEntities.length,
        description: risk.description,
        measuredValue: risk.measuredValue,
        threshold: risk.threshold,
        suggestion: risk.suggestion,
      })),
      architecture: {
        layers: result.semanticEffects.architecture.layers.map((layer) => ({
          name: layer.name,
          fileCount: layer.fileCount,
          role: layer.role,
        })),
        boundaryCrossings: result.semanticEffects.architecture.boundaryCrossings,
      },
    },
    score: result.score,
    evidence: result.evidence,
    warnings: result.warnings,
    complete: result.complete,
    truncations: result.truncations,
    appliedBounds: result.appliedBounds,
  };
}

function toWorkingTreeImpactData(
  result: import('@project-dna/dna-core').WorkingTreeImpactResult,
): import('@project-dna/shared').WorkingTreeImpactData {
  const unresolvedPaths = result.unresolvedPaths.filter(isSupportedWorkingTreeUnresolvedPath);
  const hasUnsupportedLegacyState = unresolvedPaths.length !== result.unresolvedPaths.length;
  return {
    repositoryId: result.repositoryId,
    headCommit: result.headCommit,
    changedPaths: result.changedPaths,
    resolvedTargets: result.resolvedTargets,
    unresolvedPaths,
    impacts: result.impacts.map((impact) => ({
      path: impact.path,
      side: impact.side,
      result: toImpactResultData(impact.result),
    })),
    changedEntityIds: result.changedEntityIds,
    impactedEntityIds: result.impactedEntityIds,
    provenance: result.provenance,
    changeSet: result.changeSet
      ? {
          addedEntityIds: result.changeSet.addedEntityIds,
          removedEntityIds: result.changeSet.removedEntityIds,
          modifiedEntities: result.changeSet.modifiedEntities.map(toIdentifiedChangeData),
          addedRelationships: result.changeSet.addedRelationships.map((relationship) => ({
            sourceId: relationship.sourceId,
            targetId: relationship.targetId,
            type: relationship.attributes.type,
          })),
          removedRelationships: result.changeSet.removedRelationships.map((relationship) => ({
            sourceId: relationship.sourceId,
            targetId: relationship.targetId,
            type: relationship.attributes.type,
          })),
          modifiedRelationships: result.changeSet.modifiedRelationships.map((relationship) => ({
            sourceId: relationship.sourceId,
            targetId: relationship.targetId,
            changes: relationship.changes.map(toFieldChangeData),
          })),
          addedDomainIds: result.changeSet.addedDomainIds,
          removedDomainIds: result.changeSet.removedDomainIds,
          modifiedDomains: result.changeSet.modifiedDomains.map(toIdentifiedChangeData),
          addedRiskIds: result.changeSet.addedRiskIds,
          resolvedRiskIds: result.changeSet.resolvedRiskIds,
          modifiedRisks: result.changeSet.modifiedRisks.map(toIdentifiedChangeData),
          domainMembershipChanges: result.changeSet.domainMembershipChanges,
          architectureMembershipChanges: result.changeSet.architectureMembershipChanges,
          unavailableCollections: result.changeSet.unavailableCollections,
        }
      : null,
    beforeAnalysisVersion: result.beforeAnalysisVersion,
    afterAnalysisVersion: result.afterAnalysisVersion,
    warnings: hasUnsupportedLegacyState
      ? [
          ...result.warnings,
          'Legacy working-tree analysis state is unsupported by this UI boundary.',
        ]
      : result.warnings,
    complete: result.complete,
    truncations: result.truncations,
  };
}

function toCommitImpactData(
  result: import('@project-dna/dna-core').CommitImpactResult,
): import('@project-dna/shared').CommitImpactData {
  return {
    repositoryId: result.repositoryId,
    commitSha: result.commitSha,
    parentCommits: [...result.parentCommits],
    selectedParentSha: result.parentCommitSha,
    changedFiles: [...result.changedFiles],
    before: toCommitProvenanceData(result.before),
    after: toCommitProvenanceData(result.after),
    changeSet: result.changeSet
      ? {
          addedEntityIds: result.changeSet.addedEntityIds,
          removedEntityIds: result.changeSet.removedEntityIds,
          modifiedEntities: result.changeSet.modifiedEntities.map(toIdentifiedChangeData),
          addedRelationships: result.changeSet.addedRelationships.map((relationship) => ({
            sourceId: relationship.sourceId,
            targetId: relationship.targetId,
            type: relationship.attributes.type,
          })),
          removedRelationships: result.changeSet.removedRelationships.map((relationship) => ({
            sourceId: relationship.sourceId,
            targetId: relationship.targetId,
            type: relationship.attributes.type,
          })),
          modifiedRelationships: result.changeSet.modifiedRelationships.map((relationship) => ({
            sourceId: relationship.sourceId,
            targetId: relationship.targetId,
            changes: relationship.changes.map(toFieldChangeData),
          })),
          addedDomainIds: result.changeSet.addedDomainIds,
          removedDomainIds: result.changeSet.removedDomainIds,
          modifiedDomains: result.changeSet.modifiedDomains.map(toIdentifiedChangeData),
          addedRiskIds: result.changeSet.addedRiskIds,
          resolvedRiskIds: result.changeSet.resolvedRiskIds,
          modifiedRisks: result.changeSet.modifiedRisks.map(toIdentifiedChangeData),
          domainMembershipChanges: result.changeSet.domainMembershipChanges,
          architectureMembershipChanges: result.changeSet.architectureMembershipChanges,
          unavailableCollections: result.changeSet.unavailableCollections,
        }
      : null,
    impacts: result.impacts.map((impact) => ({
      side: impact.side,
      path: impact.path,
      ...(impact.previousPath ? { previousPath: impact.previousPath } : {}),
      entityId: impact.entityId,
      sourceAvailable: impact.sourceAvailable,
      provenance: toCommitProvenanceData(impact.provenance),
      result: toImpactResultData(impact.result),
    })),
    summary: result.summary,
    unresolved: result.unresolved,
    warnings: result.warnings,
    complete: result.complete,
    truncations: result.truncations,
  };
}

function toPullRequestImpactData(
  result: import('@project-dna/dna-core').PullRequestImpactResult,
): import('@project-dna/shared').PullRequestImpactData {
  return {
    repositoryId: result.repositoryId,
    baseCommitSha: result.baseCommitSha,
    headCommitSha: result.headCommitSha,
    baseTreeSha: result.baseTreeSha,
    headTreeSha: result.headTreeSha,
    mergeBaseSha: result.mergeBaseSha,
    changedFiles: [...result.changedFiles],
    beforeProvenance: { ...result.beforeProvenance },
    afterProvenance: { ...result.afterProvenance },
    changeSet: result.changeSet
      ? {
          addedEntityIds: result.changeSet.addedEntityIds,
          removedEntityIds: result.changeSet.removedEntityIds,
          modifiedEntities: result.changeSet.modifiedEntities.map(toIdentifiedChangeData),
          addedRelationships: result.changeSet.addedRelationships.map((relationship) => ({
            sourceId: relationship.sourceId,
            targetId: relationship.targetId,
            type: relationship.attributes.type,
          })),
          removedRelationships: result.changeSet.removedRelationships.map((relationship) => ({
            sourceId: relationship.sourceId,
            targetId: relationship.targetId,
            type: relationship.attributes.type,
          })),
          modifiedRelationships: result.changeSet.modifiedRelationships.map((relationship) => ({
            sourceId: relationship.sourceId,
            targetId: relationship.targetId,
            changes: relationship.changes.map(toFieldChangeData),
          })),
          addedDomainIds: result.changeSet.addedDomainIds,
          removedDomainIds: result.changeSet.removedDomainIds,
          modifiedDomains: result.changeSet.modifiedDomains.map(toIdentifiedChangeData),
          addedRiskIds: result.changeSet.addedRiskIds,
          resolvedRiskIds: result.changeSet.resolvedRiskIds,
          modifiedRisks: result.changeSet.modifiedRisks.map(toIdentifiedChangeData),
          domainMembershipChanges: result.changeSet.domainMembershipChanges,
          architectureMembershipChanges: result.changeSet.architectureMembershipChanges,
          unavailableCollections: result.changeSet.unavailableCollections,
        }
      : null,
    impacts: result.impacts.map((impact) => ({
      side: impact.side,
      path: impact.path,
      ...(impact.previousPath ? { previousPath: impact.previousPath } : {}),
      entityId: impact.entityId,
      sourceAvailable: impact.sourceAvailable,
      result: toImpactResultData(impact.result),
    })),
    summary: result.summary,
    warnings: result.warnings,
    complete: result.complete,
    unresolved: result.unresolved,
    truncations: result.truncations,
  };
}

function toCommitProvenanceData(
  provenance: import('@project-dna/dna-core').CommitAnalysisProvenance,
): import('@project-dna/shared').CommitImpactData['before'] {
  return {
    repositoryId: provenance.repositoryId,
    commitSha: provenance.commitSha,
    treeSha: provenance.treeSha,
    parentCommitSha: provenance.parentCommitSha,
    parentTreeSha: provenance.parentTreeSha,
    analysisConfigFingerprint: provenance.analysisConfigFingerprint,
    contentFingerprint: provenance.contentFingerprint,
    source: provenance.source,
  };
}

function toIdentifiedChangeData(change: {
  readonly id: string;
  readonly changes: readonly {
    readonly field: string;
    readonly from?: unknown;
    readonly to?: unknown;
  }[];
}) {
  return { id: change.id, changes: change.changes.map(toFieldChangeData) };
}

function toFieldChangeData(change: {
  readonly field: string;
  readonly from?: unknown;
  readonly to?: unknown;
}) {
  return {
    field: change.field,
    from: presentCommitValue(change.from),
    to: presentCommitValue(change.to),
  };
}

function presentCommitValue(value: unknown): string {
  if (value === undefined) return 'Unavailable';
  if (value === null) return 'None';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function isSupportedWorkingTreeUnresolvedPath(
  path: import('@project-dna/dna-core').WorkingTreeUnresolvedPath,
): path is WorkingTreeUnresolvedPathData {
  return path.reason !== 'legacy-analysis-state-unavailable';
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
