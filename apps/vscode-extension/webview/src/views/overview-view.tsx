import { useEffect, useState } from 'react';
import type { EvolutionData, RepositoryData, WorkspaceRelativePath } from '@project-dna/shared';
import { Badge, EmptyCollection, MetricCard, ProgressBar, Section } from '../components/ui';
import { Panel, StatusIndicator, TreeView, type TreeItem } from '@project-dna/ui-components';

type RiskSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';

const severityLevels: Array<Exclude<RiskSeverity, 'info'>> = ['low', 'medium', 'high', 'critical'];

export function OverviewView({
  data,
  evolution,
  error,
  onOpenWorkspaceTarget,
  onCompareEvolution,
  onRequestWorkingTreeImpact,
  onRequestCommitImpact,
  onRequestPullRequestImpact,
  onRefresh,
}: {
  data: RepositoryData | null;
  evolution: EvolutionData | null;
  error: string | null;
  onOpenWorkspaceTarget: (path: WorkspaceRelativePath) => void;
  onCompareEvolution: (fromVersion: number, toVersion: number) => void;
  onRequestWorkingTreeImpact?: () => void;
  onRequestCommitImpact?: () => void;
  onRequestPullRequestImpact?: () => void;
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
  const healthAvailable = data.coverage.parsed > 0;
  const parsedCoverage =
    data.coverage.scanned > 0 ? (data.coverage.parsed / data.coverage.scanned) * 100 : 0;

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
      <section className="mb-4 rounded border border-dna-border bg-dna-surface p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-dna-muted">
              Repository health
            </p>
            <h2 className="mt-1 text-2xl font-semibold leading-none">
              {healthAvailable ? `${Math.round(data.health.overallScore)}/100` : 'Unavailable'}
            </h2>
            <p className="mt-2 truncate text-xs text-dna-muted" title={data.story.healthSummary}>
              {healthAvailable
                ? `${formatLabel(data.health.trend)} trend · ${data.story.healthSummary}`
                : 'No parsed files available for health analysis.'}
            </p>
          </div>
          <div className="flex shrink-0 flex-col gap-1.5">
            <button
              aria-label="Refresh repository intelligence"
              className="rounded border border-dna-border px-2.5 py-1.5 text-xs font-medium text-dna-foreground hover:bg-dna-surface-hover"
              onClick={onRefresh}
              type="button"
            >
              Refresh
            </button>
            {onRequestWorkingTreeImpact ? (
              <button
                className="rounded border border-dna-border px-2.5 py-1.5 text-xs font-medium text-dna-foreground hover:bg-dna-surface-hover"
                onClick={onRequestWorkingTreeImpact}
                type="button"
              >
                Working Tree Impact
              </button>
            ) : null}
            {onRequestCommitImpact ? (
              <button
                className="rounded border border-dna-border px-2.5 py-1.5 text-xs font-medium text-dna-foreground hover:bg-dna-surface-hover"
                onClick={onRequestCommitImpact}
                type="button"
              >
                Commit Impact
              </button>
            ) : null}
            {onRequestPullRequestImpact ? (
              <button
                className="rounded border border-dna-border px-2.5 py-1.5 text-xs font-medium text-dna-foreground hover:bg-dna-surface-hover"
                onClick={onRequestPullRequestImpact}
                type="button"
              >
                PR Impact
              </button>
            ) : null}
          </div>
        </div>
        {healthAvailable ? (
          <ProgressBar
            className="mt-4 mb-0"
            fillClassName="bg-dna-active"
            label="Overall health"
            trackClassName="bg-dna-surface-hover"
            value={data.health.overallScore}
          />
        ) : null}
      </section>

      <div className="mb-5 min-w-0">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">{data.name}</h3>
          <p className="mt-1 text-xs leading-relaxed text-dna-muted">{data.description}</p>
        </div>
      </div>

      {error ? (
        <div
          aria-live="polite"
          className="mb-4 rounded border border-error p-3 text-sm text-error"
          role="status"
        >
          {error}
        </div>
      ) : null}

      <div className="mb-5 grid grid-cols-2 gap-2">
        <MetricCard
          className="border-dna-border bg-dna-surface"
          label="Heuristic health"
          value={healthAvailable ? `${Math.round(data.health.overallScore)}/100` : 'Unavailable'}
        />
        <MetricCard
          className="border-dna-border bg-dna-surface"
          label="Risk exposure"
          value={`${Math.round(data.risks.overallRiskScore)}/100`}
        />
        <MetricCard
          className="border-dna-border bg-dna-surface"
          label="Entities"
          value={data.counts.entities.toLocaleString()}
        />
        <MetricCard
          className="border-dna-border bg-dna-surface"
          label="Modules"
          value={data.counts.modules.toLocaleString()}
        />
      </div>

      <Section
        className="rounded border border-dna-border bg-dna-surface p-3"
        title="Repository intelligence"
      >
        <p className="text-sm leading-relaxed">{data.story.summary}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge>{data.projectType}</Badge>
          <Badge>{data.repositorySize}</Badge>
          {data.packageManager ? <Badge>{data.packageManager}</Badge> : null}
          <Badge>{data.health.trend}</Badge>
        </div>
      </Section>

      {healthAvailable ? (
        <Section
          className="rounded border border-dna-border bg-dna-surface p-3"
          title="Heuristic health signals"
        >
          <ProgressBar
            fillClassName="bg-dna-active"
            label="Architecture evidence"
            trackClassName="bg-dna-surface-hover"
            value={data.health.dimensions.architectureHealth}
          />
          <ProgressBar
            fillClassName="bg-dna-active"
            label="Dependency structure"
            trackClassName="bg-dna-surface-hover"
            value={data.health.dimensions.dependencyHealth}
          />
          <ProgressBar
            fillClassName="bg-dna-active"
            label="Complexity"
            trackClassName="bg-dna-surface-hover"
            value={data.health.dimensions.complexityHealth}
          />
          <ProgressBar
            fillClassName="bg-dna-active"
            label="Knowledge coverage"
            trackClassName="bg-dna-surface-hover"
            value={data.health.dimensions.knowledgeHealth}
          />
          <ProgressBar
            className="mb-0"
            fillClassName="bg-dna-active"
            label="Risk resilience"
            trackClassName="bg-dna-surface-hover"
            value={data.health.dimensions.riskHealth}
          />
        </Section>
      ) : (
        <Section
          className="rounded border border-dna-border bg-dna-surface p-3"
          title="Heuristic health signals"
        >
          <EmptyCollection>No parsed files are available for health analysis.</EmptyCollection>
        </Section>
      )}

      <Section
        className="rounded border border-dna-border bg-dna-surface p-3"
        title="Analysis coverage"
      >
        <div className="grid grid-cols-2 gap-2">
          <MetricCard
            className="border-dna-border bg-dna-background"
            label="Scanned"
            value={data.coverage.scanned.toLocaleString()}
          />
          <MetricCard
            className="border-dna-border bg-dna-background"
            label="Parsed"
            value={data.coverage.parsed.toLocaleString()}
          />
          <MetricCard
            className="border-dna-border bg-dna-background"
            label="Skipped"
            value={data.coverage.skipped.toLocaleString()}
          />
          <MetricCard
            className="border-dna-border bg-dna-background"
            label="Failed"
            value={data.coverage.failed.toLocaleString()}
          />
        </div>
        {data.coverage.scanned > 0 ? (
          <ProgressBar
            className="mt-4 mb-0"
            fillClassName="bg-dna-active"
            label="Parsed coverage"
            trackClassName="bg-dna-surface-hover"
            value={parsedCoverage}
          />
        ) : null}
        {data.coverage.skipped > 0 || data.coverage.failed > 0 ? (
          <p className="mt-3 text-xs leading-relaxed text-dna-muted">
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

      <Section className="rounded border border-dna-border bg-dna-surface p-3" title="Top risks">
        {data.risks.topRisks.length === 0 ? (
          <EmptyCollection>No high-priority risks were detected.</EmptyCollection>
        ) : (
          <div aria-label="Top risks list" className="space-y-2">
            {data.risks.topRisks.map((risk, index) => (
              <div
                key={`${risk.type}-${index}`}
                className="rounded border border-dna-border bg-dna-background p-3"
              >
                <div className="mb-2 flex items-start justify-between gap-2">
                  <span className="min-w-0 text-sm font-medium">{formatLabel(risk.type)}</span>
                  <RiskSeverityIndicator severity={risk.severity} />
                </div>
                <p className="text-xs leading-relaxed text-dna-muted">{risk.description}</p>
                <p className="mt-2 text-xs text-dna-muted">
                  Affects {risk.affectedEntityCount.toLocaleString()}{' '}
                  {risk.affectedEntityCount === 1 ? 'entity' : 'entities'}
                </p>
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

function RiskSeverityIndicator({ severity }: { severity: string }) {
  const normalizedSeverity = isRiskSeverity(severity) ? severity : 'info';
  const activeLevel =
    normalizedSeverity === 'info' ? 0 : severityLevels.indexOf(normalizedSeverity) + 1;
  const label = formatLabel(severity);
  const severityClasses = {
    low: 'bg-[var(--vscode-testing-iconPassed)]',
    medium: 'bg-[var(--vscode-editorWarning-foreground)]',
    high: 'bg-[var(--vscode-charts-orange,#f59e0b)]',
    critical: 'bg-[var(--vscode-editorError-foreground)]',
    info: 'bg-dna-muted',
  } as const;

  return (
    <div
      aria-label={`Severity: ${label}`}
      className="flex shrink-0 items-center gap-1.5"
      role="img"
    >
      <span aria-hidden="true" className="grid grid-cols-4 gap-0.5">
        {severityLevels.map((level, index) => (
          <span
            aria-hidden="true"
            className={`h-1.5 w-3 rounded-sm ${
              index < activeLevel ? severityClasses[normalizedSeverity] : 'bg-dna-surface-hover'
            }`}
            key={level}
          />
        ))}
      </span>
      <span className="text-xs font-medium text-dna-foreground">{label}</span>
    </div>
  );
}

function isRiskSeverity(value: string): value is RiskSeverity {
  return ['info', 'low', 'medium', 'high', 'critical'].includes(value);
}

function formatLabel(value: string): string {
  return value.replaceAll('-', ' ').replace(/\b\w/gu, (character) => character.toUpperCase());
}

function formatDuration(durationMs: number): string {
  return durationMs < 1000 ? `${Math.round(durationMs)} ms` : `${(durationMs / 1000).toFixed(1)} s`;
}
