import { useEffect, useState } from 'react';
import type { EvolutionData, RepositoryData, WorkspaceRelativePath } from '@project-dna/shared';
import { Badge, EmptyCollection, MetricCard, ProgressBar, Section } from '../components/ui';
import { Panel, StatusIndicator, TreeView, type TreeItem } from '@project-dna/ui-components';

export function OverviewView({
  data,
  evolution,
  error,
  onOpenWorkspaceTarget,
  onCompareEvolution,
  onRefresh,
}: {
  data: RepositoryData | null;
  evolution: EvolutionData | null;
  error: string | null;
  onOpenWorkspaceTarget: (path: WorkspaceRelativePath) => void;
  onCompareEvolution: (fromVersion: number, toVersion: number) => void;
  onRefresh: () => void;
}) {
  const availableVersions = [...(evolution?.history ?? [])]
    .map(({ version }) => version)
    .sort((left, right) => left - right);
  const [fromVersion, setFromVersion] = useState(availableVersions.at(-2) ?? availableVersions[0]);
  const [toVersion, setToVersion] = useState(availableVersions.at(-1));

  useEffect(() => {
    setFromVersion((current) =>
      current !== undefined && availableVersions.includes(current)
        ? current
        : (availableVersions.at(-2) ?? availableVersions[0]),
    );
    setToVersion((current) =>
      current !== undefined && availableVersions.includes(current)
        ? current
        : availableVersions.at(-1),
    );
  }, [availableVersions.join(',')]);

  if (!data) return <EmptyCollection>Repository overview data is not available.</EmptyCollection>;

  const criticalItems: TreeItem[] = data.criticalComponents.map((component, index) => ({
    id: `critical:${index}:${component.path}`,
    label: component.name,
    description: `${component.path} · ${formatLabel(component.criticality)} · score ${Math.round(component.score * 100)}%`,
    children: [
      {
        id: `critical:${index}:reason`,
        label: component.reason,
        description: 'Criticality rationale',
      },
    ],
  }));
  const criticalPathsByItemId = new Map(
    data.criticalComponents.map((component, index) => [
      `critical:${index}:${component.path}`,
      component.path,
    ]),
  );

  const evolutionItems: TreeItem[] = (evolution?.history ?? []).map((snapshot) => ({
    id: `evolution:${snapshot.id}`,
    label: `v${snapshot.version} · ${formatLabel(snapshot.trigger)}`,
    description: `${new Date(snapshot.timestamp).toISOString()} · ${snapshot.gitCommitHash ?? 'no commit'}`,
    children: Object.entries(snapshot.metrics)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => ({
        id: `evolution:${snapshot.id}:metric:${key}`,
        label: `${formatLabel(key)}: ${value}`,
        description: 'Snapshot metric',
      })),
  }));

  return (
    <div className="pb-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-xl font-bold">{data.name}</h2>
          <p className="mt-1 text-sm leading-relaxed text-description">{data.description}</p>
        </div>
        <button
          className="shrink-0 rounded bg-vscode-button px-3 py-1 text-vscode-buttonForeground hover:bg-vscode-buttonHover"
          onClick={onRefresh}
        >
          Refresh
        </button>
      </div>

      {error ? (
        <div className="mb-4 rounded border border-error p-3 text-sm text-error">{error}</div>
      ) : null}

      <div className="mb-5 grid grid-cols-2 gap-2">
        <MetricCard
          label="Heuristic health"
          value={
            data.coverage.parsed > 0 ? `${Math.round(data.health.overallScore)}/100` : 'Unavailable'
          }
        />
        <MetricCard
          label="Risk exposure"
          value={`${Math.round(data.risks.overallRiskScore)}/100`}
        />
        <MetricCard label="Entities" value={data.counts.entities.toLocaleString()} />
        <MetricCard label="Modules" value={data.counts.modules.toLocaleString()} />
      </div>

      <Section title="Repository intelligence">
        <p className="text-sm leading-relaxed">{data.story.summary}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge>{data.projectType}</Badge>
          <Badge>{data.repositorySize}</Badge>
          <Badge>DNA v{data.version}</Badge>
          <Badge>{data.health.trend}</Badge>
        </div>
      </Section>

      {data.coverage.parsed > 0 ? (
        <Section title="Heuristic health signals">
          <ProgressBar
            label="Architecture evidence"
            value={data.health.dimensions.architectureHealth}
          />
          <ProgressBar
            label="Dependency structure"
            value={data.health.dimensions.dependencyHealth}
          />
          <ProgressBar label="Complexity" value={data.health.dimensions.complexityHealth} />
          <ProgressBar label="Knowledge coverage" value={data.health.dimensions.knowledgeHealth} />
          <ProgressBar label="Risk resilience" value={data.health.dimensions.riskHealth} />
        </Section>
      ) : (
        <Section title="Heuristic health signals">
          <EmptyCollection>No parsed files are available for health analysis.</EmptyCollection>
        </Section>
      )}

      <Section title="Analysis coverage">
        <div className="grid grid-cols-2 gap-2">
          <MetricCard label="Scanned" value={data.coverage.scanned.toLocaleString()} />
          <MetricCard label="Parsed" value={data.coverage.parsed.toLocaleString()} />
          <MetricCard label="Skipped" value={data.coverage.skipped.toLocaleString()} />
          <MetricCard label="Failed" value={data.coverage.failed.toLocaleString()} />
        </div>
        {data.coverage.skipped > 0 || data.coverage.failed > 0 ? (
          <p className="mt-2 text-xs leading-relaxed text-description">
            Health and graph results cover successfully parsed files only.
          </p>
        ) : null}
      </Section>

      <Section title="Code profile">
        {data.languages.length === 0 ? (
          <EmptyCollection>No supported source languages were detected.</EmptyCollection>
        ) : (
          <div className="space-y-2">
            {data.languages.map((language) => (
              <div
                key={language.language}
                className="rounded border border-panel-border bg-panel p-3"
              >
                <div className="flex justify-between gap-3 text-sm">
                  <span className="font-medium">{language.language}</span>
                  <span className="text-description">{language.percentage.toFixed(1)}%</span>
                </div>
                <div className="mt-1 text-xs text-description">
                  {language.fileCount.toLocaleString()} files ·{' '}
                  {language.linesOfCode.toLocaleString()} lines
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Top risks">
        {data.risks.topRisks.length === 0 ? (
          <EmptyCollection>No high-priority risks were detected.</EmptyCollection>
        ) : (
          <div className="space-y-2">
            {data.risks.topRisks.map((risk, index) => (
              <div key={`${risk.type}-${index}`} className="rounded border border-panel-border p-3">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{formatLabel(risk.type)}</span>
                  <Badge>{risk.severity}</Badge>
                </div>
                <p className="text-xs leading-relaxed text-description">{risk.description}</p>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Panel collapsible title="Critical components">
        {criticalItems.length === 0 ? (
          <EmptyCollection>No critical components were identified.</EmptyCollection>
        ) : (
          <TreeView
            ariaLabel="Critical components"
            defaultExpandedIds={criticalItems.map(({ id }) => id)}
            items={criticalItems}
            onSelect={(item) => {
              const path = criticalPathsByItemId.get(item.id);
              if (path) onOpenWorkspaceTarget(path);
            }}
          />
        )}
      </Panel>

      <Panel collapsible title="Evolution">
        {!evolution || evolutionItems.length === 0 ? (
          <EmptyCollection>No evolution snapshots are available.</EmptyCollection>
        ) : (
          <>
            <div className="mb-3 flex items-center justify-between gap-2">
              <StatusIndicator
                label={
                  evolution.latestSnapshot
                    ? `Latest snapshot v${evolution.latestSnapshot.version}`
                    : 'Latest snapshot unavailable'
                }
                status={evolution.latestSnapshot ? 'success' : 'idle'}
              />
              <Badge>{evolutionItems.length} snapshots</Badge>
            </div>
            <TreeView
              ariaLabel="Evolution snapshots"
              defaultExpandedIds={evolutionItems.map(({ id }) => id)}
              items={evolutionItems}
            />
            {availableVersions.length >= 2 ? (
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <label className="text-xs">
                  From
                  <select
                    className="ml-1 bg-vscode-background"
                    onChange={(event) => setFromVersion(Number(event.currentTarget.value))}
                    value={fromVersion}
                  >
                    {availableVersions.map((version) => (
                      <option key={version} value={version}>
                        v{version}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs">
                  To
                  <select
                    className="ml-1 bg-vscode-background"
                    onChange={(event) => setToVersion(Number(event.currentTarget.value))}
                    value={toVersion}
                  >
                    {availableVersions.map((version) => (
                      <option key={version} value={version}>
                        v{version}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="rounded bg-vscode-button px-3 py-1 text-vscode-buttonForeground disabled:opacity-50"
                  disabled={
                    fromVersion === undefined || toVersion === undefined || fromVersion >= toVersion
                  }
                  onClick={() => {
                    if (fromVersion !== undefined && toVersion !== undefined) {
                      onCompareEvolution(fromVersion, toVersion);
                    }
                  }}
                  type="button"
                >
                  Compare snapshots
                </button>
              </div>
            ) : null}
          </>
        )}
      </Panel>

      <div className="text-xs text-description">
        Analyzed {new Date(data.analyzedAt).toLocaleString()} in {formatDuration(data.durationMs)}
      </div>
    </div>
  );
}

function formatLabel(value: string): string {
  return value.replaceAll('-', ' ').replace(/\b\w/gu, (character) => character.toUpperCase());
}

function formatDuration(durationMs: number): string {
  return durationMs < 1000 ? `${Math.round(durationMs)} ms` : `${(durationMs / 1000).toFixed(1)} s`;
}
