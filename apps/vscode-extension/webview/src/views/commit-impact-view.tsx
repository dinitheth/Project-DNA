import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { CommitChangedFileData, CommitImpactData } from '@project-dna/shared';
import { EmptyCollection, MetricCard } from '../components/ui';
import { AnalysisChangeSetView } from '../components/analysis-change-set-view';
import { impactSeverity, ImpactSeverityIndicator } from '../components/impact-severity';
import {
  shouldFocusCommitImpactStatus,
  type CommitImpactState,
} from '../state/commit-impact-state';
import { ImpactResultView } from './impact-view';

const FULL_SHA = /^[0-9a-f]{40}$/u;

export function CommitImpactView({
  state,
  repositoryName,
  onRequest,
  onCancel,
  onClose,
}: {
  state: CommitImpactState;
  repositoryName: string;
  onRequest: (commitSha: string, selectedParentSha: string | null) => void;
  onCancel: () => void;
  onClose: () => void;
}) {
  const [commitInput, setCommitInput] = useState(state.commitSha ?? '');
  const [selectedParent, setSelectedParent] = useState('');
  const [validation, setValidation] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const statusRef = useRef<HTMLElement>(null);
  const previousStatus = useRef(state.status);

  useEffect(() => {
    if (state.commitSha) setCommitInput(state.commitSha);
  }, [state.commitSha]);
  useEffect(() => {
    if (state.status === 'parent-selection') setSelectedParent('');
  }, [state.status, state.requestId]);
  useEffect(() => {
    if (shouldFocusCommitImpactStatus(previousStatus.current, state.status)) {
      if (state.status === 'ready') headingRef.current?.focus();
      else statusRef.current?.focus();
    }
    previousStatus.current = state.status;
  }, [state.status]);

  if (!state.visible) return null;

  const submitCommit = () => {
    const commitSha = commitInput.trim();
    if (!FULL_SHA.test(commitSha)) {
      setValidation('Enter the full 40-character lowercase commit SHA.');
      return;
    }
    setValidation(null);
    onRequest(commitSha, null);
  };

  return (
    <section aria-labelledby="commit-impact-title" className="mb-4 space-y-3">
      <header className="rounded border border-dna-border bg-dna-surface p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase text-dna-muted">Historical analysis</p>
            <h2
              className="mt-1 text-base font-semibold"
              id="commit-impact-title"
              ref={headingRef}
              tabIndex={-1}
            >
              Commit Impact
            </h2>
            <p className="mt-1 truncate text-xs text-dna-muted" title={repositoryName}>
              Repository: {repositoryName}
            </p>
          </div>
          <button
            aria-label="Close Commit Impact"
            className="rounded border border-dna-border px-2 py-1 text-xs hover:bg-dna-surface-hover"
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </div>
        <form
          className="mt-3 space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            submitCommit();
          }}
        >
          <label className="block text-xs font-medium" htmlFor="commit-impact-sha">
            Commit SHA
          </label>
          <input
            aria-describedby={validation ? 'commit-impact-input-error' : undefined}
            autoCapitalize="none"
            autoComplete="off"
            className="w-full rounded border border-dna-border bg-dna-background px-2 py-1.5 font-mono text-xs text-dna-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-dna-active"
            id="commit-impact-sha"
            maxLength={40}
            onChange={(event) => setCommitInput(event.target.value)}
            placeholder="40-character commit SHA"
            spellCheck={false}
            value={commitInput}
          />
          {validation ? (
            <p className="text-xs text-error" id="commit-impact-input-error" role="alert">
              {validation}
            </p>
          ) : null}
          <button
            className="rounded border border-dna-border px-2.5 py-1.5 text-xs font-medium hover:bg-dna-surface-hover disabled:opacity-50"
            disabled={state.status === 'loading'}
            type="submit"
          >
            Analyze Commit
          </button>
        </form>
      </header>

      {state.status === 'loading' ? (
        <section
          aria-live="polite"
          className="rounded border border-dna-border bg-dna-surface p-3"
          ref={statusRef as RefObject<HTMLElement>}
          role="status"
          tabIndex={-1}
        >
          <p className="text-sm font-semibold">Analyzing historical commit</p>
          <p className="mt-1 break-all text-xs text-dna-muted">Commit: {state.commitSha}</p>
          <p className="mt-1 text-xs text-dna-muted">
            Materializing and comparing immutable Git trees.
          </p>
          <button
            className="mt-3 rounded border border-dna-border px-2.5 py-1.5 text-xs"
            onClick={onCancel}
            type="button"
          >
            Cancel
          </button>
        </section>
      ) : null}

      {state.status === 'parent-selection' && state.commitSha ? (
        <section
          aria-live="polite"
          className="rounded border border-dna-border bg-dna-surface p-3"
          ref={statusRef as RefObject<HTMLElement>}
          role="status"
          tabIndex={-1}
        >
          <h3 className="text-sm font-semibold">Select merge parent</h3>
          <p className="mt-1 break-all text-xs text-dna-muted">
            Commit: {shortSha(state.commitSha)}
          </p>
          <label className="mt-3 block text-xs font-medium" htmlFor="commit-impact-parent">
            Compared against
          </label>
          <select
            className="mt-1 w-full rounded border border-dna-border bg-dna-background px-2 py-1.5 font-mono text-xs"
            id="commit-impact-parent"
            onChange={(event) => setSelectedParent(event.target.value)}
            value={selectedParent}
          >
            <option value="">Select a direct parent</option>
            {state.parentCommits.map((parent) => (
              <option key={parent} value={parent}>
                {shortSha(parent)}
              </option>
            ))}
          </select>
          <p className="mt-2 text-xs text-dna-muted">
            This analysis compares the commit against the selected parent. It is not a combined
            merge diff.
          </p>
          <button
            className="mt-3 rounded border border-dna-border px-2.5 py-1.5 text-xs font-medium disabled:opacity-50"
            disabled={!selectedParent}
            onClick={() => {
              if (selectedParent) onRequest(state.commitSha!, selectedParent);
            }}
            type="button"
          >
            Analyze Against Parent
          </button>
        </section>
      ) : null}

      {state.status === 'cancelled' ? (
        <section
          aria-live="polite"
          className="rounded border border-dna-border bg-dna-surface p-3 text-sm"
          ref={statusRef as RefObject<HTMLElement>}
          role="status"
          tabIndex={-1}
        >
          Commit impact analysis cancelled.
        </section>
      ) : null}

      {state.status === 'error' ? (
        <section
          aria-live="assertive"
          className="rounded border border-error p-3 text-sm text-error"
          ref={statusRef as RefObject<HTMLElement>}
          role="alert"
          tabIndex={-1}
        >
          <h3 className="font-semibold">Commit impact unavailable</h3>
          <p className="mt-1">{state.error}</p>
        </section>
      ) : null}

      {state.status === 'ready' && state.result ? (
        <CommitImpactResultView data={state.result} />
      ) : null}
    </section>
  );
}

export function CommitImpactResultView({ data }: { data: CommitImpactData }) {
  const incomplete = !data.complete || data.unresolved.length > 0 || data.truncations.length > 0;

  return (
    <div className="space-y-3">
      <section className="rounded border border-dna-border bg-dna-surface p-3">
        <p className="text-xs font-semibold uppercase text-dna-muted">Historical provenance</p>
        <dl className="mt-2 grid grid-cols-1 gap-2 text-xs min-[320px]:grid-cols-2">
          <ProvenanceItem label="Commit" value={shortSha(data.commitSha)} title={data.commitSha} />
          <ProvenanceItem
            label={data.parentCommits.length > 1 ? 'Compared against' : 'Parent'}
            value={data.selectedParentSha ? shortSha(data.selectedParentSha) : 'Empty tree'}
            title={data.selectedParentSha ?? 'Canonical empty Git tree'}
          />
          <ProvenanceItem
            label="Before tree"
            value={shortSha(data.before.treeSha)}
            title={data.before.treeSha}
          />
          <ProvenanceItem
            label="After tree"
            value={shortSha(data.after.treeSha)}
            title={data.after.treeSha}
          />
          <ProvenanceItem label="Before source" value={formatLabel(data.before.source)} />
          <ProvenanceItem label="After source" value={formatLabel(data.after.source)} />
        </dl>
        {data.parentCommits.length > 1 ? (
          <div className="mt-3 text-xs text-dna-muted">
            <p className="font-medium text-dna-foreground">Parents</p>
            {data.parentCommits.map((parent) => (
              <p className="mt-1 break-all font-mono" key={parent}>
                {parent}
              </p>
            ))}
            <p className="mt-2">
              This analysis compares the commit against the selected parent. It is not a combined
              merge diff.
            </p>
          </div>
        ) : null}
      </section>

      <ImpactSummary data={data} />

      <section aria-labelledby="commit-changed-files-title">
        <h3
          className="mb-2 text-xs font-semibold uppercase text-dna-muted"
          id="commit-changed-files-title"
        >
          Changed files
        </h3>
        {data.changedFiles.length === 0 ? (
          <EmptyCollection>No changed files were reported for this comparison.</EmptyCollection>
        ) : (
          <ul className="space-y-1.5">
            {data.changedFiles.map((file) => {
              const key = fileKey(file);
              return (
                <li className="rounded border border-dna-border bg-dna-surface p-2" key={key}>
                  <ChangedFile data={data} file={file} />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <AnalysisChangeSetView changeSet={data.changeSet} />

      {data.impacts.length > 0 ? (
        <section aria-labelledby="commit-impact-entries-title">
          <h3
            className="mb-2 text-xs font-semibold uppercase text-dna-muted"
            id="commit-impact-entries-title"
          >
            Impacted areas
          </h3>
          <div className="space-y-2">
            {data.impacts.map((entry) => (
              <HistoricalImpactEntry entry={entry} key={`${entry.side}:${entry.path}`} />
            ))}
          </div>
        </section>
      ) : null}

      {data.unresolved.length > 0 ? (
        <section
          aria-labelledby="commit-unresolved-title"
          className="rounded border border-dna-border bg-dna-surface p-3"
        >
          <h3
            className="text-xs font-semibold uppercase text-dna-muted"
            id="commit-unresolved-title"
          >
            Unresolved historical changes
          </h3>
          <div className="mt-2 space-y-2">
            {data.unresolved.map((item) => (
              <div
                className="rounded border border-dna-border p-2 text-xs"
                key={`${item.side}:${item.path}:${item.reason}`}
              >
                <p className="break-all font-medium">{item.path}</p>
                <p className="mt-1 text-dna-muted">
                  {formatLabel(item.side)} · {unresolvedMessage(item.reason)}
                </p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {incomplete || data.warnings.length > 0 ? (
        <Notice role="status" title="Historical analysis notes">
          {data.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
          {data.truncations.map((item) => (
            <p key={`${item.kind}:${item.limit}`}>
              Output limited at {item.limit} ({formatLabel(item.kind)}).
            </p>
          ))}
          {incomplete ? (
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

function ImpactSummary({ data }: { data: CommitImpactData }) {
  const score = data.summary.highestScore;
  return (
    <section aria-labelledby="commit-summary-title">
      <h3 className="mb-2 text-xs font-semibold uppercase text-dna-muted" id="commit-summary-title">
        Impact summary
      </h3>
      <section className="rounded border border-dna-border bg-dna-surface p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-dna-muted">Highest target impact</span>
          <strong className="text-xs">
            {score === null ? 'Unavailable' : impactSeverity(score)}
          </strong>
        </div>
        {score === null ? (
          <p className="mt-2 text-xs text-dna-muted">
            No resolved impact score is available. Incomplete evidence is not treated as zero
            impact.
          </p>
        ) : (
          <ImpactSeverityIndicator label="Highest commit target impact" score={score} />
        )}
      </section>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <MetricCard label="Changed entities" value={data.summary.changedEntityIds.length} />
        <MetricCard label="Affected entities" value={data.summary.impactedEntityIds.length} />
        <MetricCard label="Domains" value={data.summary.domainIds.length} />
        <MetricCard label="Capabilities" value={data.summary.capabilityIds.length} />
        <MetricCard label="Critical" value={data.summary.criticalComponentIds.length} />
        <MetricCard label="Risks" value={data.summary.riskIds.length} />
        <MetricCard label="Architecture" value={data.summary.architectureLayers.length} />
        <MetricCard label="Boundaries" value={data.summary.boundaryEvidence.length} />
      </div>
    </section>
  );
}

function ChangedFile({ data, file }: { data: CommitImpactData; file: CommitChangedFileData }) {
  const beforePath = file.previousPath ?? file.path;
  const before = sideState(data, beforePath, 'before');
  const after = sideState(data, file.path, 'after');
  return (
    <span className="block min-w-0 text-xs">
      <span className="flex flex-wrap items-center gap-2">
        <strong>{formatLabel(file.kind)}</strong>
        <span className="text-dna-muted">{formatLabel(file.contentKind)}</span>
      </span>
      <span className="mt-1 block break-all font-mono text-dna-foreground">
        {file.previousPath ? `${file.previousPath} -> ${file.path}` : file.path}
      </span>
      <span className="mt-1 block text-dna-muted">
        Before: {before} · After: {after}
      </span>
      {file.oldBlobSha || file.newBlobSha ? (
        <span className="mt-1 block break-all text-dna-muted">
          Blobs: {file.oldBlobSha ? shortSha(file.oldBlobSha) : 'none'} -&gt;{' '}
          {file.newBlobSha ? shortSha(file.newBlobSha) : 'none'}
        </span>
      ) : null}
      {file.kind === 'deleted' ? (
        <span className="mt-1 block text-dna-muted">
          Deleted from this commit; analysis uses the retained parent-tree entity.
        </span>
      ) : null}
      {file.contentKind !== 'text' ? (
        <span className="mt-1 block text-dna-muted">{specialFileMessage(file.contentKind)}</span>
      ) : (
        <span className="mt-1 block text-dna-muted">
          Historical source available for analysis; current workspace navigation unavailable.
        </span>
      )}
    </span>
  );
}

function HistoricalImpactEntry({ entry }: { entry: CommitImpactData['impacts'][number] }) {
  const [open, setOpen] = useState(false);
  const contentId = useId();
  return (
    <section className="rounded border border-dna-border bg-dna-surface p-2">
      <button
        aria-controls={contentId}
        aria-expanded={open}
        className="w-full text-left"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <span className="block break-all text-xs font-medium">{entry.path}</span>
        <span className="mt-1 block break-all text-xs text-dna-muted">
          {formatLabel(entry.side)} · entity {entry.entityId} · score{' '}
          {Math.round(entry.result.score.total)}/100
        </span>
      </button>
      <div hidden={!open} id={contentId}>
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

function ProvenanceItem({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-dna-muted">{label}</dt>
      <dd className="break-all font-mono font-medium" title={title}>
        {value}
      </dd>
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
  role?: 'status' | 'alert';
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

function fileKey(file: CommitChangedFileData | undefined): string {
  return file ? `${file.kind}:${file.previousPath ?? ''}:${file.path}` : '';
}

function sideState(data: CommitImpactData, path: string, side: 'before' | 'after'): string {
  if (data.impacts.some((entry) => entry.side === side && entry.path === path)) return 'Resolved';
  const unresolved = data.unresolved.find((entry) => entry.side === side && entry.path === path);
  if (unresolved) return `Unresolved (${formatLabel(unresolved.reason)})`;
  return 'Not applicable';
}

function unresolvedMessage(reason: CommitImpactData['unresolved'][number]['reason']): string {
  return {
    'analysis-unavailable': 'Historical analysis unavailable.',
    'binary-not-analyzable': 'Binary file; source analysis unavailable.',
    'symlink-not-analyzable': 'Symlink; target content was not analyzed.',
    'submodule-not-analyzable': 'Submodule; nested repository content was not analyzed.',
    'missing-entity': 'No canonical file entity was resolved for this historical side.',
  }[reason];
}

function specialFileMessage(kind: CommitChangedFileData['contentKind']): string {
  return {
    binary: 'Binary file; source analysis unavailable.',
    symlink: 'Symlink; target content was not analyzed.',
    submodule: 'Submodule; nested repository content was not analyzed.',
    unknown: 'File type could not be analyzed.',
    text: '',
  }[kind];
}

function shortSha(sha: string): string {
  return sha.slice(0, 8);
}

function formatLabel(value: string): string {
  return value.replaceAll('-', ' ').replace(/\b\w/gu, (letter) => letter.toUpperCase());
}
