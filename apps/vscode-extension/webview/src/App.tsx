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
        return <OverviewView data={repository} error={error} onRefresh={refresh} />;
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
      <nav className="mb-4 border-b border-panel-border pb-2" aria-label="Project DNA views">
        <div className="grid grid-cols-2 gap-2">
          {(['overview', 'architecture', 'knowledge', 'dependencies'] as SidebarRoute[]).map(
            (route) => (
              <button
                key={route}
                className={`justify-self-start rounded px-3 py-1 capitalize ${navigation.route === route ? 'bg-vscode-button text-vscode-buttonForeground' : 'hover:bg-list-hover'}`}
                onClick={() => navigate(route)}
              >
                {route}
              </button>
            ),
          )}
        </div>
        <div className="mt-2">
          <button
            className={`w-full rounded px-3 py-1 text-left capitalize ${navigation.route === 'settings' ? 'bg-vscode-button text-vscode-buttonForeground' : 'hover:bg-list-hover'}`}
            onClick={() => navigate('settings')}
          >
            settings
          </button>
        </div>
      </nav>
      <main className="flex-1 overflow-auto">{renderView()}</main>
    </div>
  );
}

function StatusPanel({
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
  return (
    <div className="rounded border border-panel-border bg-panel p-4">
      <h2 className={`text-lg font-semibold ${tone === 'error' ? 'text-error' : ''}`}>{title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-description">{message}</p>
      {progress !== undefined ? (
        <div className="mt-4 h-2 overflow-hidden rounded bg-progress-background">
          <div
            className="h-full rounded bg-progress transition-all"
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
        </div>
      ) : null}
      {actionLabel && onAction ? (
        <button
          className="mt-4 rounded bg-vscode-button px-3 py-1.5 text-vscode-buttonForeground hover:bg-vscode-buttonHover"
          onClick={onAction}
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
