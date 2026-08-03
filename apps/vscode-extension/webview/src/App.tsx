import React, { useState } from 'react';
import { OverviewView } from './views/overview-view';
import { ArchitectureView } from './views/architecture-view';
import { KnowledgeView } from './views/knowledge-view';
import { DependenciesView } from './views/dependencies-view';
import { SettingsView } from './views/settings-view';

type ViewType = 'overview' | 'architecture' | 'knowledge' | 'dependencies' | 'settings';

export default function App() {
  const [currentView, setCurrentView] = useState<ViewType>('overview');

  const renderView = () => {
    switch (currentView) {
      case 'overview':
        return <OverviewView />;
      case 'architecture':
        return <ArchitectureView />;
      case 'knowledge':
        return <KnowledgeView />;
      case 'dependencies':
        return <DependenciesView />;
      case 'settings':
        return <SettingsView />;
      default:
        return <OverviewView />;
    }
  };

  return (
    <div className="flex flex-col h-screen text-vscode-foreground bg-vscode-background p-4">
      <div className="flex space-x-2 border-b border-gray-600 mb-4 pb-2 flex-wrap gap-y-2">
        {(['overview', 'architecture', 'knowledge', 'dependencies', 'settings'] as ViewType[]).map(
          (v) => (
            <button
              key={v}
              className={`px-3 py-1 capitalize rounded ${currentView === v ? 'bg-vscode-button text-vscode-buttonForeground' : 'hover:bg-gray-700'}`}
              onClick={() => setCurrentView(v)}
            >
              {v}
            </button>
          ),
        )}
      </div>
      <div className="flex-1 overflow-auto">{renderView()}</div>
    </div>
  );
}
