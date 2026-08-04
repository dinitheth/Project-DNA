import type { RepositoryData } from '@project-dna/shared';
import { Badge, EmptyCollection, Section } from '../components/ui';

export function SettingsView({
  data,
  onAnalyze,
  onRefresh,
}: {
  data: RepositoryData | null;
  onAnalyze: () => void;
  onRefresh: () => void;
}) {
  return (
    <div className="pb-4">
      <h2 className="text-xl font-bold">Settings</h2>
      <p className="mt-1 text-sm leading-relaxed text-description">
        Analysis configuration is currently managed by Project DNA defaults.
      </p>

      <Section title="Repository">
        {data ? (
          <div className="rounded border border-panel-border bg-panel p-3">
            <div className="break-all text-sm">{data.rootPath}</div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge>DNA v{data.version}</Badge>
              {data.packageManager ? <Badge>{data.packageManager}</Badge> : null}
              {data.testFramework ? <Badge>{data.testFramework}</Badge> : null}
            </div>
          </div>
        ) : (
          <EmptyCollection>No repository analysis is loaded.</EmptyCollection>
        )}
      </Section>

      <Section title="Actions">
        <div className="flex flex-col gap-2">
          <button
            className="rounded bg-vscode-button px-3 py-1.5 text-left text-vscode-buttonForeground hover:bg-vscode-buttonHover"
            onClick={data ? onRefresh : onAnalyze}
          >
            {data ? 'Refresh Repository DNA' : 'Analyze Repository'}
          </button>
          {data ? (
            <button
              className="rounded border border-panel-border px-3 py-1.5 text-left hover:bg-list-hover"
              onClick={onAnalyze}
            >
              Run Full Analysis
            </button>
          ) : null}
        </div>
      </Section>

      <Section title="Current scope">
        <p className="text-xs leading-relaxed text-description">
          Custom ignore patterns, language selection, and analysis thresholds will appear only when
          their persistence and validation workflow is implemented. This screen does not pretend to
          save settings that the engine cannot yet apply.
        </p>
      </Section>
    </div>
  );
}
