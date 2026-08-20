import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { ImpactTargetData, SidebarRoute, WorkspaceRelativePath } from '@project-dna/shared';
import { useMessage } from './hooks/useMessage';
import { useVSCodeApi } from './hooks/useVSCodeApi';
import { initialAnalysisState, reduceAnalysisState } from './state/analysis-state';
import { OverviewView } from './views/overview-view';
import { ArchitectureView } from './views/architecture-view';
import { KnowledgeView } from './views/knowledge-view';
import { DependenciesView } from './views/dependencies-view';
import { SettingsView } from './views/settings-view';
import { ImpactView } from './views/impact-view';
import type { NavigationFeedback } from './views/impact-view';
import { WorkingTreeImpactView } from './views/working-tree-impact-view';
import { CommitImpactView } from './views/commit-impact-view';
import { SidebarNavigationController, type NavigationState } from './state/navigation-state';
import {
  reduceEntityDetailState,
  restoreEntityDetailState,
  type EntityDetailState,
} from './state/entity-detail-state';
import { reduceImpactState, restoreImpactState } from './state/impact-state';
import {
  reduceWorkingTreeImpactState,
  restoreWorkingTreeImpactState,
} from './state/working-tree-impact-state';
import { reduceCommitImpactState, restoreCommitImpactState } from './state/commit-impact-state';
import {
  reduceEvolutionComparisonState,
  restoreEvolutionComparisonState,
  type EvolutionComparisonState,
} from './state/evolution-comparison-state';

export default function App() {
  const vscode = useVSCodeApi();
  const navigationController = useRef<SidebarNavigationController | null>(null);
  const workspaceTargetRequestId = useRef(0);
  const activeImpactNavigationRequestId = useRef<number | null>(null);
  const [navigationFeedback, setNavigationFeedback] = useState<NavigationFeedback | null>(null);
  const restoredEntityDetail = useRef(restoreEntityDetailState(vscode.getState()));
  const entityDetailRequestId = useRef(
    restoredEntityDetail.current.requestId === Number.MAX_SAFE_INTEGER
      ? 0
      : restoredEntityDetail.current.requestId + 1,
  );
  navigationController.current ??= new SidebarNavigationController(vscode);
  const [navigation, setNavigation] = useState<NavigationState>(() =>
    navigationController.current!.getSnapshot(),
  );
  const [analysis, dispatchAnalysis] = useReducer(reduceAnalysisState, initialAnalysisState);
  const [entityDetail, dispatchEntityDetail] = useReducer(
    reduceEntityDetailState,
    restoredEntityDetail.current,
  );
  const restoredEvolutionComparison = useRef(restoreEvolutionComparisonState(vscode.getState()));
  const restoredImpact = useRef(restoreImpactState(vscode.getState()));
  const restoredWorkingTreeImpact = useRef(restoreWorkingTreeImpactState(vscode.getState()));
  const restoredCommitImpact = useRef(restoreCommitImpactState(vscode.getState()));
  const impactRequestId = useRef(
    restoredImpact.current.requestId === Number.MAX_SAFE_INTEGER
      ? 0
      : restoredImpact.current.requestId + 1,
  );
  const workingTreeImpactRequestId = useRef(
    restoredWorkingTreeImpact.current.requestId === Number.MAX_SAFE_INTEGER
      ? 0
      : restoredWorkingTreeImpact.current.requestId + 1,
  );
  const [impact, dispatchImpact] = useReducer(reduceImpactState, restoredImpact.current);
  const [workingTreeImpact, dispatchWorkingTreeImpact] = useReducer(
    reduceWorkingTreeImpactState,
    restoredWorkingTreeImpact.current,
  );
  const commitImpactRequestId = useRef(
    restoredCommitImpact.current.requestId === Number.MAX_SAFE_INTEGER
      ? 0
      : restoredCommitImpact.current.requestId + 1,
  );
  const [commitImpact, dispatchCommitImpact] = useReducer(
    reduceCommitImpactState,
    restoredCommitImpact.current,
  );
  const [evolutionComparison, dispatchEvolutionComparison] = useReducer(
    reduceEvolutionComparisonState,
    restoredEvolutionComparison.current,
  );
  const evolutionRequestId = useRef(
    restoredEvolutionComparison.current.requestId === Number.MAX_SAFE_INTEGER
      ? 0
      : restoredEvolutionComparison.current.requestId + 1,
  );
  const {
    status,
    workspaceRoot,
    progress,
    error,
    repository,
    architecture,
    dependencies,
    knowledge,
    semanticGraph,
    evolution,
  } = analysis;

  const handleMessage = useCallback((message: Parameters<typeof dispatchAnalysis>[0]) => {
    if (message.type === 'navigateTo') {
      navigationController.current?.receive(message);
      return;
    }
    if (
      message.type === 'workspaceTargetResult' &&
      message.requestId === activeImpactNavigationRequestId.current
    ) {
      activeImpactNavigationRequestId.current = null;
      setNavigationFeedback({
        requestId: message.requestId,
        path: message.path,
        outcome: message.outcome,
        message: message.message ?? null,
      });
    }
    dispatchEntityDetail({ type: 'message', message });
    dispatchEvolutionComparison({ type: 'message', message });
    dispatchImpact({ type: 'message', message });
    dispatchWorkingTreeImpact({ type: 'message', message });
    dispatchCommitImpact({ type: 'message', message });
    dispatchAnalysis(message);
  }, []);
  useMessage(handleMessage);

  useEffect(() => {
    const controller = navigationController.current!;
    const unsubscribe = controller.subscribe(setNavigation);
    controller.start();
    return unsubscribe;
  }, []);

  useEffect(() => {
    const current = vscode.getState();
    vscode.setState({
      ...(current && typeof current === 'object' ? current : {}),
      entityDetail,
    });
  }, [entityDetail, vscode]);

  useEffect(() => {
    const current = vscode.getState();
    vscode.setState({
      ...(current && typeof current === 'object' ? current : {}),
      evolutionComparison,
    });
  }, [evolutionComparison, vscode]);

  useEffect(() => {
    const current = vscode.getState();
    vscode.setState({
      ...(current && typeof current === 'object' ? current : {}),
      impact,
    });
  }, [impact, vscode]);

  useEffect(() => {
    const current = vscode.getState();
    vscode.setState({
      ...(current && typeof current === 'object' ? current : {}),
      workingTreeImpact,
    });
  }, [workingTreeImpact, vscode]);

  useEffect(() => {
    const current = vscode.getState();
    vscode.setState({
      ...(current && typeof current === 'object' ? current : {}),
      commitImpact,
    });
  }, [commitImpact, vscode]);

  useEffect(() => {
    if (entityDetail.status !== 'loading' || !entityDetail.entityId) return;
    vscode.postMessage({
      type: 'requestEntityDetail',
      requestId: entityDetail.requestId,
      analysisVersion: entityDetail.analysisVersion,
      entityId: entityDetail.entityId,
    });
  }, []);

  useEffect(() => {
    if (commitImpact.status !== 'loading' || !commitImpact.commitSha) return;
    vscode.postMessage({
      type: 'requestCommitImpact',
      requestId: commitImpact.requestId,
      commitSha: commitImpact.commitSha,
      ...(commitImpact.selectedParentSha
        ? { selectedParentSha: commitImpact.selectedParentSha }
        : {}),
    });
  }, []);

  useEffect(() => {
    if (impact.status !== 'loading' || !impact.target) return;
    vscode.postMessage({
      type: 'requestImpact',
      requestId: impact.requestId,
      analysisVersion: impact.analysisVersion,
      target: impact.target,
    });
  }, []);

  useEffect(() => {
    if (workingTreeImpact.status !== 'loading') return;
    vscode.postMessage({
      type: 'requestWorkingTreeImpact',
      requestId: workingTreeImpact.requestId,
      analysisVersion: workingTreeImpact.analysisVersion,
    });
  }, []);

  useEffect(() => {
    if (
      evolutionComparison.status !== 'loading' ||
      evolutionComparison.fromVersion === null ||
      evolutionComparison.toVersion === null
    ) {
      return;
    }
    vscode.postMessage({
      type: 'requestEvolutionComparison',
      requestId: evolutionComparison.requestId,
      analysisVersion: evolutionComparison.analysisVersion,
      fromVersion: evolutionComparison.fromVersion,
      toVersion: evolutionComparison.toVersion,
    });
  }, []);

  const analyze = () => vscode.postMessage({ type: 'requestAnalysis' });
  const refresh = () => vscode.postMessage({ type: 'requestRefresh' });
  const openWorkspaceTarget = useCallback(
    (path: WorkspaceRelativePath) => {
      const requestId = workspaceTargetRequestId.current;
      if (requestId === Number.MAX_SAFE_INTEGER) workspaceTargetRequestId.current = 0;
      else workspaceTargetRequestId.current++;
      activeImpactNavigationRequestId.current = null;
      setNavigationFeedback(null);
      vscode.postMessage({ type: 'openWorkspaceTarget', requestId, path });
    },
    [vscode],
  );
  const openImpactWorkspaceTarget = useCallback(
    (path: WorkspaceRelativePath) => {
      const requestId = workspaceTargetRequestId.current;
      if (requestId === Number.MAX_SAFE_INTEGER) workspaceTargetRequestId.current = 0;
      else workspaceTargetRequestId.current++;
      activeImpactNavigationRequestId.current = requestId;
      setNavigationFeedback(null);
      vscode.postMessage({ type: 'openWorkspaceTarget', requestId, path });
    },
    [vscode],
  );
  const selectEntity = useCallback(
    (entityId: string) => {
      const requestId = entityDetailRequestId.current;
      entityDetailRequestId.current = requestId === Number.MAX_SAFE_INTEGER ? 0 : requestId + 1;
      dispatchEntityDetail({
        type: 'select',
        requestId,
        entityId,
        analysisVersion: analysis.latestVersion,
      });
      vscode.postMessage({
        type: 'requestEntityDetail',
        requestId,
        analysisVersion: analysis.latestVersion,
        entityId,
      });
    },
    [analysis.latestVersion, vscode],
  );
  const compareEvolution = useCallback(
    (fromVersion: number, toVersion: number) => {
      const requestId = evolutionRequestId.current;
      evolutionRequestId.current = requestId === Number.MAX_SAFE_INTEGER ? 0 : requestId + 1;
      dispatchEvolutionComparison({
        type: 'select',
        requestId,
        analysisVersion: analysis.latestVersion,
        fromVersion,
        toVersion,
      });
      vscode.postMessage({
        type: 'requestEvolutionComparison',
        requestId,
        analysisVersion: analysis.latestVersion,
        fromVersion,
        toVersion,
      });
    },
    [analysis.latestVersion, vscode],
  );
  const analyzeImpact = useCallback(
    (target: ImpactTargetData) => {
      const requestId = impactRequestId.current;
      impactRequestId.current = requestId === Number.MAX_SAFE_INTEGER ? 0 : requestId + 1;
      dispatchImpact({
        type: 'select',
        requestId,
        analysisVersion: analysis.latestVersion,
        target,
      });
      vscode.postMessage({
        type: 'requestImpact',
        requestId,
        analysisVersion: analysis.latestVersion,
        target,
      });
    },
    [analysis.latestVersion, vscode],
  );
  const cancelImpact = useCallback(() => {
    if (impact.status !== 'loading') return;
    vscode.postMessage({ type: 'cancelImpact', requestId: impact.requestId });
    dispatchImpact({ type: 'cancel', requestId: impact.requestId });
  }, [impact, vscode]);
  const requestWorkingTreeImpact = useCallback(() => {
    const requestId = workingTreeImpactRequestId.current;
    workingTreeImpactRequestId.current = requestId === Number.MAX_SAFE_INTEGER ? 0 : requestId + 1;
    dispatchWorkingTreeImpact({
      type: 'request',
      requestId,
      analysisVersion: analysis.latestVersion,
    });
    vscode.postMessage({
      type: 'requestWorkingTreeImpact',
      requestId,
      analysisVersion: analysis.latestVersion,
    });
  }, [analysis.latestVersion, vscode]);
  const cancelWorkingTreeImpact = useCallback(() => {
    if (workingTreeImpact.status !== 'loading') return;
    vscode.postMessage({ type: 'cancelWorkingTreeImpact', requestId: workingTreeImpact.requestId });
    dispatchWorkingTreeImpact({ type: 'cancel', requestId: workingTreeImpact.requestId });
  }, [workingTreeImpact, vscode]);
  const openCommitImpact = useCallback(() => {
    dispatchCommitImpact({ type: 'open' });
  }, []);
  const requestCommitImpact = useCallback(
    (commitSha: string, selectedParentSha: string | null) => {
      const requestId = commitImpactRequestId.current;
      commitImpactRequestId.current = requestId === Number.MAX_SAFE_INTEGER ? 0 : requestId + 1;
      dispatchCommitImpact({ type: 'request', requestId, commitSha, selectedParentSha });
      vscode.postMessage({
        type: 'requestCommitImpact',
        requestId,
        commitSha,
        ...(selectedParentSha ? { selectedParentSha } : {}),
      });
    },
    [vscode],
  );
  const cancelCommitImpact = useCallback(() => {
    if (commitImpact.status !== 'loading') return;
    vscode.postMessage({ type: 'cancelCommitImpact', requestId: commitImpact.requestId });
    dispatchCommitImpact({ type: 'cancel', requestId: commitImpact.requestId });
  }, [commitImpact, vscode]);
  const closeCommitImpact = useCallback(() => {
    if (commitImpact.status === 'loading') {
      vscode.postMessage({ type: 'cancelCommitImpact', requestId: commitImpact.requestId });
    }
    dispatchCommitImpact({ type: 'close' });
  }, [commitImpact, vscode]);

  const renderView = () => {
    if (status === 'loading') {
      return <StatusPanel title="Loading Project DNA…" message="Checking for saved analysis." />;
    }
    if (status === 'empty') {
      return (
        <StatusPanel
          title={workspaceRoot ? 'Repository ready to analyze' : 'Open a repository'}
          message={
            workspaceRoot
              ? 'Project DNA has not analyzed this workspace yet.'
              : 'Open a workspace folder, then run Project DNA analysis.'
          }
          actionLabel={workspaceRoot ? 'Analyze Repository' : undefined}
          onAction={workspaceRoot ? analyze : undefined}
        />
      );
    }
    if (status === 'analyzing') {
      return (
        <StatusPanel
          title="Analyzing repository"
          message={progress?.message ?? 'Project DNA is building repository intelligence.'}
          progress={progress?.percent ?? 0}
        />
      );
    }
    if (status === 'error' && !repository) {
      return (
        <StatusPanel
          title="Analysis could not be loaded"
          message={error ?? 'An unknown error occurred.'}
          actionLabel="Try Analysis Again"
          onAction={analyze}
          tone="error"
        />
      );
    }

    switch (navigation.route) {
      case 'overview':
        return (
          <OverviewView
            data={repository}
            evolution={evolution}
            error={error}
            onOpenWorkspaceTarget={openWorkspaceTarget}
            onCompareEvolution={compareEvolution}
            onRequestWorkingTreeImpact={requestWorkingTreeImpact}
            onRequestCommitImpact={openCommitImpact}
            onRefresh={refresh}
          />
        );
      case 'architecture':
        return <ArchitectureView data={architecture} onOpenWorkspaceTarget={openWorkspaceTarget} />;
      case 'knowledge':
        return (
          <KnowledgeView
            data={knowledge}
            onOpenWorkspaceTarget={openWorkspaceTarget}
            semanticGraph={semanticGraph}
            onSelectEntity={selectEntity}
          />
        );
      case 'dependencies':
        return (
          <DependenciesView
            data={dependencies}
            onAnalyzeImpact={analyzeImpact}
            onRequestWorkingTreeImpact={requestWorkingTreeImpact}
            onOpenWorkspaceTarget={openWorkspaceTarget}
          />
        );
      case 'settings':
        return <SettingsView data={repository} onAnalyze={analyze} onRefresh={refresh} />;
    }
  };

  const navigate = (route: SidebarRoute) => {
    navigationController.current?.navigate(route);
  };

  return (
    <div className="flex h-screen min-w-0 flex-col overflow-hidden bg-dna-background text-dna-foreground">
      <header className="z-10 shrink-0 border-b border-dna-border bg-dna-background px-3 pb-2 pt-3">
        <WorkspaceHeader repositoryName={repository?.name} workspaceRoot={workspaceRoot} />
        <SidebarNavigation activeRoute={navigation.route} onNavigate={navigate} />
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <ImpactView
          navigationFeedback={navigationFeedback}
          state={impact}
          onCancel={cancelImpact}
          onSelectEntity={selectEntity}
          onOpenWorkspaceTarget={openImpactWorkspaceTarget}
        />
        <WorkingTreeImpactView
          repositoryName={repository?.name ?? workspaceLabel(workspaceRoot) ?? 'Current workspace'}
          state={workingTreeImpact}
          onCancel={cancelWorkingTreeImpact}
          onSelectEntity={selectEntity}
          onOpenWorkspaceTarget={openImpactWorkspaceTarget}
        />
        <CommitImpactView
          repositoryName={repository?.name ?? workspaceLabel(workspaceRoot) ?? 'Current repository'}
          state={commitImpact}
          onCancel={cancelCommitImpact}
          onClose={closeCommitImpact}
          onRequest={requestCommitImpact}
        />
        {renderView()}
        <EntityDetailPanel
          detail={entityDetail}
          onAnalyzeImpact={analyzeImpact}
          onOpenWorkspaceTarget={openWorkspaceTarget}
        />
        <EvolutionComparisonPanel comparison={evolutionComparison} />
      </main>
    </div>
  );
}

export function WorkspaceHeader({
  repositoryName,
  workspaceRoot,
}: {
  repositoryName?: string;
  workspaceRoot: string | null;
}) {
  const workspaceName = repositoryName ?? workspaceLabel(workspaceRoot) ?? 'No workspace open';

  return (
    <div aria-label="Workspace context" className="mb-3 min-w-0">
      <h1 className="truncate text-sm font-semibold leading-5" title={workspaceName}>
        {workspaceName}
      </h1>
    </div>
  );
}

function workspaceLabel(workspaceRoot: string | null): string | undefined {
  return workspaceRoot?.split(/[\\/]/u).filter(Boolean).at(-1);
}

function EvolutionComparisonPanel({ comparison }: { comparison: EvolutionComparisonState }) {
  if (comparison.status === 'idle') return null;
  return (
    <section aria-live="polite" className="mt-4 rounded border border-panel-border bg-panel p-4">
      <h2 className="text-lg font-semibold">Evolution comparison</h2>
      {comparison.status === 'loading' ? <p>Comparing snapshots…</p> : null}
      {comparison.status === 'error' ? <p role="alert">{comparison.error}</p> : null}
      {comparison.comparison ? (
        <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
          <dt>Added entities</dt>
          <dd>{comparison.comparison.addedEntities.length}</dd>
          <dt>Removed entities</dt>
          <dd>{comparison.comparison.removedEntities.length}</dd>
          <dt>Changed entities</dt>
          <dd>{comparison.comparison.changedEntities.length}</dd>
          <dt>Health delta</dt>
          <dd>{comparison.comparison.healthDelta.overall}</dd>
          <dt>New risks</dt>
          <dd>{comparison.comparison.newRisks.length}</dd>
          <dt>Resolved risks</dt>
          <dd>{comparison.comparison.resolvedRisks.length}</dd>
          <dt>Graph edges added</dt>
          <dd>{comparison.comparison.addedEdges}</dd>
          <dt>Graph edges removed</dt>
          <dd>{comparison.comparison.removedEdges}</dd>
          <dt>Architectural significance</dt>
          <dd>{Math.round(comparison.comparison.architecturalSignificance * 100)}%</dd>
        </dl>
      ) : null}
    </section>
  );
}

function EntityDetailPanel({
  detail,
  onAnalyzeImpact,
  onOpenWorkspaceTarget,
}: {
  detail: EntityDetailState;
  onAnalyzeImpact: (target: ImpactTargetData) => void;
  onOpenWorkspaceTarget: (path: WorkspaceRelativePath) => void;
}) {
  if (detail.status === 'idle') return null;
  return (
    <section aria-live="polite" className="mt-4 rounded border border-panel-border bg-panel p-4">
      <h2 className="text-lg font-semibold">Entity details</h2>
      {detail.status === 'loading' ? <p>Loading {detail.entityId}…</p> : null}
      {detail.status === 'error' ? <p role="alert">{detail.error}</p> : null}
      {detail.entity ? (
        <>
          <p className="mt-2 font-medium">{detail.entity.name}</p>
          <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
            <dt>ID</dt>
            <dd>{detail.entity.id}</dd>
            <dt>Kind</dt>
            <dd>{detail.entity.kind}</dd>
            <dt>Purpose</dt>
            <dd>{detail.entity.purpose}</dd>
            <dt>Role</dt>
            <dd>{detail.entity.role}</dd>
            <dt>Domain</dt>
            <dd>{detail.entity.domain ?? 'Unknown'}</dd>
            <dt>Criticality</dt>
            <dd>{detail.entity.criticality}</dd>
            <dt>Health</dt>
            <dd>{Math.round(detail.entity.health * 100)}%</dd>
            <dt>Complexity</dt>
            <dd>{detail.entity.complexity}</dd>
            <dt>Dependencies</dt>
            <dd>{detail.entity.dependencies.join(', ') || 'None'}</dd>
            <dt>Dependents</dt>
            <dd>{detail.entity.dependents.join(', ') || 'None'}</dd>
            <dt>Risks</dt>
            <dd>{detail.entity.risks.join(', ') || 'None'}</dd>
            <dt>Knowledge</dt>
            <dd>{detail.entity.knowledgeReferences.join(', ') || 'None'}</dd>
          </dl>
          <button
            className="mt-3 rounded bg-vscode-button px-3 py-1 text-vscode-buttonForeground"
            onClick={() => onOpenWorkspaceTarget(detail.entity!.path)}
            type="button"
          >
            Open {detail.entity.path}
          </button>
          {detail.entity.kind === 'file' ? (
            <button
              className="ml-2 mt-3 rounded border border-dna-border px-3 py-1 text-dna-foreground"
              onClick={() => onAnalyzeImpact({ kind: 'entity', id: detail.entity!.id })}
              type="button"
            >
              Analyze impact
            </button>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

export function SidebarNavigation({
  activeRoute,
  onNavigate,
}: {
  activeRoute: SidebarRoute;
  onNavigate: (route: SidebarRoute) => void;
}) {
  return (
    <nav aria-label="Project DNA views">
      <div className="grid grid-cols-5 gap-1 rounded border border-dna-border bg-dna-surface p-1">
        {sidebarRoutes.map(({ ariaLabel, label, route }) => (
          <RouteButton
            active={activeRoute === route}
            ariaLabel={ariaLabel}
            key={route}
            label={label}
            onClick={() => onNavigate(route)}
          />
        ))}
      </div>
    </nav>
  );
}

const sidebarRoutes = [
  { ariaLabel: 'Overview', label: 'Home', route: 'overview' },
  { ariaLabel: 'Architecture', label: 'Arch', route: 'architecture' },
  { ariaLabel: 'Knowledge', label: 'Know', route: 'knowledge' },
  { ariaLabel: 'Dependencies', label: 'Deps', route: 'dependencies' },
  { ariaLabel: 'Settings', label: 'Settings', route: 'settings' },
] as const satisfies readonly { ariaLabel: string; label: string; route: SidebarRoute }[];

function RouteButton({
  active,
  ariaLabel,
  label,
  onClick,
}: {
  active: boolean;
  ariaLabel: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={ariaLabel}
      aria-current={active ? 'page' : undefined}
      className={`min-h-8 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap rounded px-1 py-1 text-center text-xs font-medium capitalize leading-4 transition-colors focus-visible:z-10 ${active ? 'bg-dna-active text-dna-foreground' : 'text-dna-muted hover:bg-dna-surface-hover hover:text-dna-foreground'}`}
      onClick={onClick}
      type="button"
      title={ariaLabel}
    >
      {label}
    </button>
  );
}

export function StatusPanel({
  title,
  message,
  actionLabel,
  onAction,
  progress,
  tone = 'default',
}: {
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  progress?: number;
  tone?: 'default' | 'error';
}) {
  const boundedProgress = progress === undefined ? undefined : Math.min(100, Math.max(0, progress));
  return (
    <div className="rounded border border-panel-border bg-panel p-4">
      <div
        aria-atomic="true"
        aria-live={tone === 'error' ? 'assertive' : 'polite'}
        role={tone === 'error' ? 'alert' : 'status'}
      >
        <h2 className={`text-lg font-semibold ${tone === 'error' ? 'text-error' : ''}`}>{title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-description">{message}</p>
        {boundedProgress !== undefined ? (
          <div
            aria-label={`${title}: ${message}`}
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={boundedProgress}
            className="mt-4 h-2 overflow-hidden rounded bg-progress-background"
            role="progressbar"
          >
            <div
              className="h-full rounded bg-progress transition-all"
              style={{ width: `${boundedProgress}%` }}
            />
          </div>
        ) : null}
      </div>
      {actionLabel && onAction ? (
        <button
          className="mt-4 rounded bg-vscode-button px-3 py-1.5 text-vscode-buttonForeground hover:bg-vscode-buttonHover"
          onClick={onAction}
          type="button"
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
