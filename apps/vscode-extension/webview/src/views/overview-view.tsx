import type { RepositoryData } from '@project-dna/shared';
import { Badge, EmptyCollection, MetricCard, ProgressBar, Section } from '../components/ui';

export function OverviewView({
  data,
  error,
  onRefresh,
}: {
  data: RepositoryData | null;
  error: string | null;
  onRefresh: () => void;
}) {
  if (!data) return <EmptyCollection>Repository overview data is not available.</EmptyCollection>;

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
