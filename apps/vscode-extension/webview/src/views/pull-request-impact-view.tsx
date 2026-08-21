import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { PullRequestImpactData } from '@project-dna/shared';
import { EmptyCollection, MetricCard, ProgressBar } from '../components/ui';
import { ImpactResultView } from './impact-view';
import type { PullRequestImpactState } from '../state/pull-request-impact-state';

const SHA_PATTERN = /^[0-9a-f]{40}$/u;

export function PullRequestImpactView({
  repositoryName,
  state,
  onRequest,
  onCancel,
  onClose,
}: {
  repositoryName: string;
  state: PullRequestImpactState;
  onRequest: (baseSha: string, headSha: string) => void;
  onCancel: () => void;
  onClose: () => void;
}) {
  const [baseSha, setBaseSha] = useState(state.baseSha ?? '');
  const [headSha, setHeadSha] = useState(state.headSha ?? '');
  const statusRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.baseSha) setBaseSha(state.baseSha);
    if (state.headSha) setHeadSha(state.headSha);
    if (state.status !== 'editing' && state.status !== 'idle') statusRef.current?.focus();
  }, [state.baseSha, state.headSha, state.status]);
  if (!state.visible) return null;
  const valid = SHA_PATTERN.test(baseSha) && SHA_PATTERN.test(headSha);
  return (
    <section aria-labelledby="pull-request-impact-title" className="mb-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase text-dna-muted">Historical analysis</p>
          <h2 className="text-lg font-semibold" id="pull-request-impact-title">
            PR Impact
          </h2>
        </div>
        <button
          aria-label="Close PR Impact"
          className="rounded border border-dna-border px-2 py-1 text-xs"
          onClick={onClose}
          type="button"
        >
          Close
        </button>
      </div>
      <p className="text-xs text-dna-muted">
        Final base tree compared with final head tree. Current workspace contents are not used.
        Current staging state is not used.
      </p>
      <form
        className="space-y-2 rounded border border-dna-border bg-dna-surface p-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) onRequest(baseSha, headSha);
        }}
      >
        <p className="text-xs text-dna-muted">
          Repository: <span className="font-medium text-dna-foreground">{repositoryName}</span>
        </p>
        <label className="block text-xs">
          Base SHA
          <input
            aria-label="Base commit SHA"
            className="mt-1 w-full min-w-0 rounded border border-dna-border bg-dna-background px-2 py-1 font-mono text-xs"
            maxLength={40}
            onChange={(event) => setBaseSha(event.target.value)}
            value={baseSha}
          />
        </label>
        <label className="block text-xs">
          Head SHA
          <input
            aria-label="Head commit SHA"
            className="mt-1 w-full min-w-0 rounded border border-dna-border bg-dna-background px-2 py-1 font-mono text-xs"
            maxLength={40}
            onChange={(event) => setHeadSha(event.target.value)}
            value={headSha}
          />
        </label>
        <div className="flex gap-2">
          <button
            className="rounded bg-vscode-button px-3 py-1.5 text-xs text-vscode-buttonForeground disabled:opacity-50"
            disabled={!valid || state.status === 'loading'}
            type="submit"
          >
            Analyze range
          </button>
          {state.status === 'loading' ? (
            <button
              className="rounded border border-dna-border px-3 py-1.5 text-xs"
              onClick={onCancel}
              type="button"
            >
              Cancel
            </button>
          ) : null}
        </div>
        {!valid && (baseSha.length > 0 || headSha.length > 0) ? (
          <p className="text-xs text-error" role="alert">
            Enter full lowercase 40-character commit SHAs.
          </p>
        ) : null}
      </form>
      <div
        aria-live="polite"
        ref={statusRef}
        role={state.status === 'error' ? 'alert' : 'status'}
        tabIndex={-1}
      >
        {state.status === 'loading' ? <p className="text-sm">Analyzing historical range…</p> : null}
        {state.status === 'cancelled' ? (
          <p className="text-sm text-dna-muted">PR impact analysis cancelled.</p>
        ) : null}
        {state.status === 'error' ? (
          <p className="text-sm text-error">{state.error ?? 'PR impact is unavailable.'}</p>
        ) : null}
      </div>
      {state.result ? <PullRequestImpactResultView data={state.result} /> : null}
    </section>
  );
}

export function PullRequestImpactResultView({ data }: { data: PullRequestImpactData }) {
  return (
    <div className="space-y-3">
      <section
        aria-labelledby="pr-provenance-title"
        className="rounded border border-dna-border bg-dna-surface p-3"
      >
        <h3 className="text-xs font-semibold uppercase text-dna-muted" id="pr-provenance-title">
          Historical provenance
        </h3>
        <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
          <Provenance label="Base" value={data.baseCommitSha} />
          <Provenance label="Head" value={data.headCommitSha} />
          <Provenance label="Merge base" value={data.mergeBaseSha ?? 'Unavailable'} />
          <Provenance label="Base tree" value={data.baseTreeSha} />
          <Provenance label="Head tree" value={data.headTreeSha} />
          <Provenance
            label="Sources"
            value={`${data.beforeProvenance.beforeSource} / ${data.afterProvenance.afterSource}`}
          />
        </dl>
      </section>
      <section aria-labelledby="pr-summary-title">
        <h3 className="mb-2 text-xs font-semibold uppercase text-dna-muted" id="pr-summary-title">
          Impact summary
        </h3>
        <div className="rounded border border-dna-border bg-dna-surface p-3">
          <p className="text-xs text-dna-muted">Highest affected-target score</p>
          {data.summary.highestScore === null ? (
            <p className="mt-2 text-xs text-dna-muted">
              No resolved score is available. Incomplete evidence is not treated as zero impact.
            </p>
          ) : (
            <ProgressBar
              label="Highest affected-target score"
              value={data.summary.highestScore}
              fillClassName={severityClass(data.summary.highestScore)}
              trackClassName="bg-dna-surface-hover"
            />
          )}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <MetricCard label="Changed entities" value={data.summary.changedEntityIds.length} />
          <MetricCard label="Affected entities" value={data.summary.impactedEntityIds.length} />
          <MetricCard label="Domains" value={data.summary.domainIds.length} />
          <MetricCard label="Capabilities" value={data.summary.capabilityIds.length} />
          <MetricCard
            label="Critical components"
            value={data.summary.criticalComponentIds.length}
          />
          <MetricCard label="Risks" value={data.summary.riskIds.length} />
          <MetricCard
            label="Architecture boundaries"
            value={data.summary.boundaryEvidence.length}
          />
        </div>
      </section>
      <ChangedFiles data={data} />
      <ChangeSet data={data} />
      {data.impacts.length > 0 ? (
        <section aria-labelledby="pr-target-impact-title">
          <h3
            className="mb-2 text-xs font-semibold uppercase text-dna-muted"
            id="pr-target-impact-title"
          >
            Impacted areas
          </h3>
          <div className="space-y-2">
            {data.impacts.map((entry) => (
              <HistoricalEntry
                entry={entry}
                key={`${entry.side}:${entry.path}:${entry.entityId}`}
              />
            ))}
          </div>
        </section>
      ) : (
        <EmptyCollection>No resolved target impacts are available.</EmptyCollection>
      )}
      {data.unresolved.length > 0 ? (
        <Notice title="Unresolved historical changes" role="status">
          {data.unresolved.map((item) => (
            <p className="break-all" key={`${item.side}:${item.path}:${item.reason}`}>
              {item.side}: {item.path} · {formatLabel(item.reason)}
            </p>
          ))}
        </Notice>
      ) : null}
      {!data.complete || data.warnings.length > 0 || data.truncations.length > 0 ? (
        <Notice title="Historical analysis notes" role="status">
          {data.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
          {data.truncations.map((item) => (
            <p key={`${item.kind}:${item.limit}`}>
              Output limited at {item.limit} ({formatLabel(item.kind)}).
            </p>
          ))}
          {!data.complete ? (
            <p>
              Historical analysis is incomplete; unresolved or bounded evidence prevents a complete
              conclusion.
            </p>
          ) : null}
        </Notice>
      ) : null}
    </div>
  );
}

function ChangedFiles({ data }: { data: PullRequestImpactData }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section aria-labelledby="pr-changed-files-title">
      <h3
        className="mb-2 text-xs font-semibold uppercase text-dna-muted"
        id="pr-changed-files-title"
      >
        Changed files
      </h3>
      {data.changedFiles.length === 0 ? (
        <EmptyCollection>No changed files were reported for this range.</EmptyCollection>
      ) : (
        <div className="space-y-1.5">
          {data.changedFiles.map((file) => {
            const key = `${file.kind}:${file.previousPath ?? ''}:${file.path}`;
            const id = `pr-file-${key.replace(/[^a-z0-9_-]/giu, '-')}`;
            return (
              <div className="rounded border border-dna-border bg-dna-surface" key={key}>
                <button
                  aria-controls={id}
                  aria-expanded={open === key}
                  className="w-full p-2 text-left text-xs"
                  onClick={() => setOpen(open === key ? null : key)}
                  type="button"
                >
                  <strong>{formatLabel(file.kind)}</strong>
                  <span className="ml-2 text-dna-muted">
                    {file.previousPath ? `${file.previousPath} -> ` : ''}
                    {file.path}
                  </span>
                </button>
                <div className="px-2 pb-2 text-xs text-dna-muted" hidden={open !== key} id={id}>
                  <p>
                    Content: {formatLabel(file.contentKind)}
                    {file.binary ? ' · binary' : ''}
                    {file.gitlink ? ' · submodule' : ''}
                  </p>
                  <p>
                    Historical source is used for analysis; current workspace navigation is
                    unavailable.
                  </p>
                  {file.kind === 'deleted' ? (
                    <p>Deleted from this range; analysis uses the retained baseline entity.</p>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ChangeSet({ data }: { data: PullRequestImpactData }) {
  if (!data.changeSet)
    return (
      <Notice title="Semantic change set unavailable" role="status">
        Before/after historical analysis was not available for deterministic comparison.
      </Notice>
    );
  const groups: Array<[string, string[], boolean]> = [
    ['Entities added', data.changeSet.addedEntityIds, false],
    ['Entities removed', data.changeSet.removedEntityIds, false],
    ['Entities modified', data.changeSet.modifiedEntities.map((item) => item.id), false],
    [
      'Relationships added',
      data.changeSet.addedRelationships.map((item) => `${item.sourceId} -> ${item.targetId}`),
      false,
    ],
    [
      'Relationships removed',
      data.changeSet.removedRelationships.map((item) => `${item.sourceId} -> ${item.targetId}`),
      false,
    ],
    [
      'Domain changes',
      [
        ...data.changeSet.addedDomainIds,
        ...data.changeSet.removedDomainIds,
        ...data.changeSet.domainMembershipChanges.map((item) => item.entityId),
      ],
      data.changeSet.unavailableCollections.includes('domains'),
    ],
    [
      'Risk changes',
      [
        ...data.changeSet.addedRiskIds,
        ...data.changeSet.resolvedRiskIds,
        ...data.changeSet.modifiedRisks.map((item) => item.id),
      ],
      data.changeSet.unavailableCollections.includes('risks'),
    ],
    [
      'Architecture membership changes',
      data.changeSet.architectureMembershipChanges.map((item) => item.entityId),
      data.changeSet.unavailableCollections.includes('architecture'),
    ],
  ];
  return (
    <section aria-labelledby="pr-change-set-title">
      <h3 className="mb-2 text-xs font-semibold uppercase text-dna-muted" id="pr-change-set-title">
        Semantic change set
      </h3>
      <div className="space-y-1.5">
        {groups.map(([title, items, unavailable]) => (
          <details className="rounded border border-dna-border bg-dna-surface p-2" key={title}>
            <summary className="cursor-pointer text-xs font-medium">
              {title}{' '}
              <span className="text-dna-muted">
                {unavailable
                  ? 'Unavailable'
                  : items.length === 0
                    ? 'No changes detected'
                    : items.length}
              </span>
            </summary>
            {unavailable ? (
              <p className="mt-2 text-xs text-dna-muted">
                Semantic collection unavailable; this is not an empty result.
              </p>
            ) : items.length === 0 ? (
              <p className="mt-2 text-xs text-dna-muted">No changes detected.</p>
            ) : (
              <ul className="mt-2 space-y-1 text-xs text-dna-muted">
                {items.map((item) => (
                  <li className="break-all" key={item}>
                    {item}
                  </li>
                ))}
              </ul>
            )}
          </details>
        ))}
      </div>
    </section>
  );
}

function HistoricalEntry({ entry }: { entry: PullRequestImpactData['impacts'][number] }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <section className="rounded border border-dna-border bg-dna-surface p-2">
      <button
        aria-controls={id}
        aria-expanded={open}
        className="w-full text-left text-xs"
        onClick={() => setOpen(!open)}
        type="button"
      >
        <span className="block break-all font-medium">{entry.path}</span>
        <span className="mt-1 block text-dna-muted">
          {entry.side} · entity {entry.entityId} · score {Math.round(entry.result.score.total)}/100
        </span>
      </button>
      <div hidden={!open} id={id}>
        <p className="mt-2 text-xs text-dna-muted">
          Historical source available for analysis; current workspace navigation unavailable.
        </p>
        <ImpactResultView
          historical
          onOpenWorkspaceTarget={() => undefined}
          onSelectEntity={() => undefined}
          result={entry.result}
        />
      </div>
    </section>
  );
}
function Provenance({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-dna-muted">{label}</dt>
      <dd className="break-all font-mono font-medium">{value}</dd>
    </div>
  );
}
function Notice({
  title,
  children,
  role,
}: {
  title: string;
  children: ReactNode;
  role: 'status' | 'alert';
}) {
  return (
    <section
      aria-live={role === 'alert' ? 'assertive' : 'polite'}
      className="rounded border border-dna-border bg-dna-surface p-3 text-xs text-dna-muted"
      role={role}
    >
      <h3 className="font-semibold text-dna-foreground">{title}</h3>
      <div className="mt-1 space-y-1">{children}</div>
    </section>
  );
}
function severityClass(score: number) {
  return score >= 75
    ? 'bg-[var(--vscode-editorError-foreground)]'
    : score >= 50
      ? 'bg-[var(--vscode-charts-orange,#f59e0b)]'
      : score >= 25
        ? 'bg-[var(--vscode-editorWarning-foreground)]'
        : 'bg-[var(--vscode-testing-iconPassed)]';
}
function formatLabel(value: string) {
  return value.replaceAll('-', ' ').replace(/\b\w/gu, (letter) => letter.toUpperCase());
}
