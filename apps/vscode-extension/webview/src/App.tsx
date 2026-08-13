import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { SidebarRoute } from '@project-dna/shared';
import { useMessage } from './hooks/useMessage';
import { useVSCodeApi } from './hooks/useVSCodeApi';
import { initialAnalysisState, reduceAnalysisState } from './state/analysis-state';
import { OverviewView } from './views/overview-view';
import { ArchitectureView } from './views/architecture-view';
import { KnowledgeView } from './views/knowledge-view';
import { DependenciesView } from './views/dependencies-view';
import { SettingsView } from './views/settings-view';
import { SidebarNavigationController, type NavigationState } from './state/navigation-state';

export default function App() {
  const vscode = useVSCodeApi();
  const navigationController = useRef<SidebarNavigationController | null>(null);
  navigationController.current ??= new SidebarNavigationController(vscode);
  const [navigation, setNavigation] = useState<NavigationState>(() =>
    navigationController.current!.getSnapshot(),
  );
  const [analysis, dispatchAnalysis] = useReducer(reduceAnalysisState, initialAnalysisState);
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
    dispatchAnalysis(message);
  }, []);
  useMessage(handleMessage);

  useEffect(() => {
    const controller = navigationController.current!;
    const unsubscribe = controller.subscribe(setNavigation);
    controller.start();
    return unsubscribe;
  }, []);

  const analyze = () => vscode.postMessage({ type: 'requestAnalysis' });
  const refresh = () => vscode.postMessage({ type: 'requestRefresh' });

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
          <OverviewView data={repository} evolution={evolution} error={error} onRefresh={refresh} />
        );
      case 'architecture':
        return <ArchitectureView data={architecture} />;
      case 'knowledge':
        return <KnowledgeView data={knowledge} semanticGraph={semanticGraph} />;
      case 'dependencies':
        return <DependenciesView data={dependencies} />;
      case 'settings':
        return <SettingsView data={repository} onAnalyze={analyze} onRefresh={refresh} />;
    }
  };

  const navigate = (route: SidebarRoute) => {
    navigationController.current?.navigate(route);
  };

  return (
    <div className="flex h-screen flex-col bg-vscode-background p-4 text-vscode-foreground">
      <SidebarNavigation activeRoute={navigation.route} onNavigate={navigate} />
      <main className="flex-1 overflow-auto">{renderView()}</main>
    </div>
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
    <nav className="mb-4 border-b border-panel-border pb-2" aria-label="Project DNA views">
      <div className="grid grid-cols-2 gap-2">
        {(['overview', 'architecture', 'knowledge', 'dependencies'] as SidebarRoute[]).map(
          (route) => (
            <RouteButton
              active={activeRoute === route}
              key={route}
              onClick={() => onNavigate(route)}
              route={route}
            />
          ),
        )}
      </div>
      <div className="mt-2">
        <RouteButton
          active={activeRoute === 'settings'}
          fullWidth
          onClick={() => onNavigate('settings')}
          route="settings"
        />
      </div>
    </nav>
  );
}

function RouteButton({
  active,
  fullWidth = false,
  onClick,
  route,
}: {
  active: boolean;
  fullWidth?: boolean;
  onClick: () => void;
  route: SidebarRoute;
}) {
  return (
    <button
      aria-current={active ? 'page' : undefined}
      className={`${fullWidth ? 'w-full text-left' : 'justify-self-start'} rounded px-3 py-1 capitalize ${active ? 'bg-vscode-button text-vscode-buttonForeground' : 'hover:bg-list-hover'}`}
      onClick={onClick}
      type="button"
    >
      {route}
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
