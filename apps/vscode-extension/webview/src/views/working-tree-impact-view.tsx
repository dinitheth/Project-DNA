import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import type {
  WorkingTreeChangedPathData,
  WorkingTreeImpactData,
  WorkingTreeUnresolvedPathData,
  WorkspaceRelativePath,
} from '@project-dna/shared';
import { EmptyCollection, MetricCard } from '../components/ui';
import { AnalysisChangeSetView } from '../components/analysis-change-set-view';
import { impactSeverity, ImpactSeverityIndicator } from '../components/impact-severity';
import {
  shouldFocusWorkingTreeStatus,
  type WorkingTreeImpactState,
} from '../state/working-tree-impact-state';
import { ImpactResultView } from './impact-view';

export function WorkingTreeImpactView({
  repositoryName,
  state,
  onCancel,
  onSelectEntity,
  onOpenWorkspaceTarget,
}: {
  repositoryName: string;
  state: WorkingTreeImpactState;
  onCancel: () => void;
  onSelectEntity: (entityId: string) => void;
  onOpenWorkspaceTarget: (path: WorkspaceRelativePath) => void;
}) {
  const previousStatus = useRef(state.status);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  const statusHeadingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (shouldFocusWorkingTreeStatus(previousStatus.current, state.status)) {
      (state.status === 'ready' ? resultHeadingRef : statusHeadingRef).current?.focus();
    }
    previousStatus.current = state.status;
  }, [state.status]);
  if (state.status === 'idle') return null;
  if (state.status === 'loading') {
    return (
      <section
        aria-live="polite"
        className="mt-4 rounded border border-dna-border bg-dna-surface p-3"
        role="status"
      >
        <h2 className="text-sm font-semibold" ref={statusHeadingRef} tabIndex={-1}>
          Working Tree Impact
        </h2>
        <p className="mt-2 text-xs text-dna-muted">Calculating working-tree analysis...</p>
        <button
          className="mt-3 rounded border border-dna-border px-3 py-1.5 text-xs"
          onClick={onCancel}
          type="button"
        >
          Cancel
        </button>
      </section>
    );
  }
  if (state.status === 'cancelled') {
    return (
      <Notice headingRef={statusHeadingRef} role="status" title="Working Tree Impact">
        Working-tree analysis cancelled.
      </Notice>
    );
  }
  if (state.status === 'error' || !state.result) {
    return (
      <Notice error headingRef={statusHeadingRef} role="alert" title="Working Tree Impact">
        {state.error ?? 'Working-tree impact is unavailable.'}
      </Notice>
    );
  }
  return (
    <WorkingTreeImpactResultView
      data={state.result}
      onOpenWorkspaceTarget={onOpenWorkspaceTarget}
      onSelectEntity={onSelectEntity}
      repositoryName={repositoryName}
      headingRef={resultHeadingRef}
    />
  );
}

export function WorkingTreeImpactResultView({
  data,
  repositoryName,
  onSelectEntity,
  onOpenWorkspaceTarget,
  headingRef,
}: {
  data: WorkingTreeImpactData;
  repositoryName: string;
  onSelectEntity: (entityId: string) => void;
  onOpenWorkspaceTarget: (path: WorkspaceRelativePath) => void;
  headingRef?: RefObject<HTMLHeadingElement>;
}) {
  const highestScore = data.impacts.reduce(
    (highest, item) => Math.max(highest, item.result.score.total),
    0,
  );
  const impactedEntityIds = new Set(data.impactedEntityIds);
  const domains = new Set<string>();
  const criticalComponents = new Set<string>();
  const risks = new Set<string>();
  const boundaries = new Set<string>();
  for (const entry of data.impacts) {
    for (const item of entry.result.semanticEffects.domains) domains.add(item.id);
    for (const item of entry.result.semanticEffects.criticalComponents) {
      criticalComponents.add(item.id);
    }
    for (const item of entry.result.semanticEffects.risks) risks.add(item.id);
    for (const item of entry.result.semanticEffects.architecture.boundaryCrossings) {
      boundaries.add(`${item.fromLayer}:${item.toLayer}:${item.dependentId}:${item.dependencyId}`);
    }
  }
  const incomplete =
    !data.complete ||
    data.unresolvedPaths.length > 0 ||
    data.impacts.some((item) => !item.result.complete);

  return (
    <section aria-labelledby="working-tree-impact-title" className="mt-4 space-y-3 pb-4">
      <header className="rounded border border-dna-border bg-dna-surface p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-dna-muted">
          Working-tree analysis
        </p>
        <h2
          className="mt-1 text-base font-semibold"
          id="working-tree-impact-title"
          ref={headingRef}
          tabIndex={-1}
        >
          Working Tree Impact
        </h2>
        <p className="mt-1 truncate text-xs text-dna-muted" title={repositoryName}>
          Repository: {repositoryName}
        </p>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
          <div>
            <dt className="text-dna-muted">HEAD</dt>
            <dd className="break-all font-medium">{data.provenance.headCommit.slice(0, 8)}</dd>
          </div>
          <div>
            <dt className="text-dna-muted">Git</dt>
            <dd className="break-all font-medium">{data.provenance.gitVersion}</dd>
          </div>
          <div>
            <dt className="text-dna-muted">Analysis</dt>
            <dd className="font-medium">Working-tree analysis</dd>
          </div>
          <div>
            <dt className="text-dna-muted">Analyzed filesystem state</dt>
            <dd className="font-medium">Current filesystem contents</dd>
          </div>
          <div>
            <dt className="text-dna-muted">Git state</dt>
            <dd className="font-medium">Staging metadata only</dd>
          </div>
          <div>
            <dt className="text-dna-muted">Change fingerprint</dt>
            <dd
              className="break-all font-mono font-medium"
              title={data.provenance.changeSetFingerprint}
            >
              {data.provenance.changeSetFingerprint.slice(0, 12)}
            </dd>
          </div>
          <div>
            <dt className="text-dna-muted">Content fingerprint</dt>
            <dd
              className="break-all font-mono font-medium"
              title={data.provenance.contentFingerprint}
            >
              {data.provenance.contentFingerprint.slice(0, 12)}
            </dd>
          </div>
        </dl>
        <p className="mt-3 text-xs leading-relaxed text-dna-muted">
          Impact is calculated from current filesystem contents. Staged and unstaged labels describe
          Git state. Staging state is metadata only; index contents are not analyzed separately.
        </p>
      </header>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-dna-muted">
          Status summary
        </h3>
        <div className="grid grid-cols-2 gap-2">
          <MetricCard
            className="border-dna-border bg-dna-surface"
            label="Changed files"
            value={data.changedPaths.length}
          />
          <MetricCard
            className="border-dna-border bg-dna-surface"
            label="Staged"
            value={data.changedPaths.filter((item) => item.staged).length}
          />
          <MetricCard
            className="border-dna-border bg-dna-surface"
            label="Unstaged"
            value={data.changedPaths.filter((item) => item.unstaged).length}
          />
          <MetricCard
            className="border-dna-border bg-dna-surface"
            label="Untracked"
            value={data.changedPaths.filter((item) => item.untracked).length}
          />
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-dna-muted">
          Impact summary
        </h3>
        <section className="rounded border border-dna-border bg-dna-surface p-3">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-dna-muted">
              Highest file impact
            </h4>
            <span className="text-xs font-medium">
              {data.impacts.length > 0
                ? impactSeverity(highestScore)
                : 'No resolved impact evidence'}
            </span>
          </div>
          {data.impacts.length > 0 ? (
            <ImpactSeverityIndicator label="Highest file impact" score={highestScore} />
          ) : (
            <p className="mt-2 text-xs text-dna-muted">
              No resolved impact evidence is available. Unresolved paths cannot be interpreted as
              zero impact.
            </p>
          )}
        </section>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <MetricCard
            className="border-dna-border bg-dna-surface"
            label="Affected entities"
            value={impactedEntityIds.size}
          />
          <MetricCard
            className="border-dna-border bg-dna-surface"
            label="Affected domains"
            value={domains.size}
          />
          <MetricCard
            className="border-dna-border bg-dna-surface"
            label="Critical components"
            value={criticalComponents.size}
          />
          <MetricCard
            className="border-dna-border bg-dna-surface"
            label="Risks"
            value={risks.size}
          />
          <MetricCard
            className="border-dna-border bg-dna-surface"
            label="Architecture boundaries"
            value={boundaries.size}
          />
        </div>
      </section>

      <section>
        <AnalysisChangeSetView changeSet={data.changeSet} title="Semantic change set" />
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-dna-muted">
          Changed files
        </h3>
        <div className="space-y-1.5">
          {data.changedPaths.length === 0 ? (
            <EmptyCollection>Working tree is clean.</EmptyCollection>
          ) : (
            data.changedPaths.map((path) => (
              <ChangedPath
                data={data}
                key={`${path.kind}:${path.path}:${path.previousPath ?? ''}`}
                path={path}
              />
            ))
          )}
        </div>
      </section>

      {data.impacts.length > 0 ? (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-dna-muted">
            Impacted areas
          </h3>
          <div className="space-y-2">
            {data.impacts.map((entry) => (
              <ImpactEntry
                entry={entry}
                key={`${entry.side}:${entry.path}`}
                canNavigate={canNavigateEntry(entry, data)}
                onOpenWorkspaceTarget={onOpenWorkspaceTarget}
                onSelectEntity={onSelectEntity}
              />
            ))}
          </div>
        </section>
      ) : null}

      {data.unresolvedPaths.length > 0 ? (
        <section
          aria-labelledby="working-tree-unresolved-title"
          className="rounded border border-dna-border bg-dna-surface p-3"
        >
          <h3
            className="text-xs font-semibold uppercase tracking-wide text-dna-muted"
            id="working-tree-unresolved-title"
          >
            Unresolved changes
          </h3>
          <div className="mt-2 space-y-2">
            {data.unresolvedPaths.map((item) => (
              <UnresolvedPath
                item={item}
                key={`${item.side}:${item.path}:${item.previousPath ?? ''}`}
              />
            ))}
          </div>
        </section>
      ) : null}

      {data.warnings.length > 0 || data.truncations.length > 0 || incomplete ? (
        <Notice role="status" title="Analysis notes">
          {data.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
          {data.truncations.map((item) => (
            <p key={`${item.kind}:${item.limit}`}>
              Output limited at {item.limit} ({item.kind}).
            </p>
          ))}
          {incomplete ? (
            <p>
              This working-tree result is incomplete; unresolved paths or bounded output prevent a
              complete conclusion.
            </p>
          ) : null}
        </Notice>
      ) : null}
      <p className="text-xs text-dna-muted">
        Analysis version: after {data.afterAnalysisVersion ?? 'unavailable'}
        {data.beforeAnalysisVersion !== null ? ` · before ${data.beforeAnalysisVersion}` : ''}
      </p>
    </section>
  );
}

function ImpactEntry({
  entry,
  canNavigate,
  onSelectEntity,
  onOpenWorkspaceTarget,
}: {
  entry: WorkingTreeImpactData['impacts'][number];
  canNavigate: boolean;
  onSelectEntity: (entityId: string) => void;
  onOpenWorkspaceTarget: (path: WorkspaceRelativePath) => void;
}) {
  const [open, setOpen] = useState(entry.side === 'after');
  const contentId = `working-tree-impact-${entry.side}-${entry.path.replaceAll(/[^a-zA-Z0-9_-]/gu, '-')}`;
  return (
    <div className="rounded border border-dna-border bg-dna-surface">
      <button
        aria-controls={contentId}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-medium hover:bg-dna-surface-hover focus-visible:outline"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span className="min-w-0 break-words">
          {entry.path} · {entry.side === 'before' ? 'Before baseline' : 'After analysis'}
        </span>
        <span aria-hidden="true">{open ? '-' : '+'}</span>
      </button>
      <div
        aria-hidden={!open}
        className="border-t border-dna-border px-2"
        hidden={!open}
        id={contentId}
      >
        {open ? (
          <ImpactResultView
            historical={!canNavigate}
            onOpenWorkspaceTarget={onOpenWorkspaceTarget}
            onSelectEntity={onSelectEntity}
            result={entry.result}
          />
        ) : null}
      </div>
    </div>
  );
}

function canNavigateEntry(
  entry: WorkingTreeImpactData['impacts'][number],
  data: WorkingTreeImpactData,
): boolean {
  if (entry.side === 'before') return false;
  return data.resolvedTargets.some(
    (target) => target.side === 'after' && target.path === entry.path && target.sourceAvailable,
  );
}

function ChangedPath({
  path,
  data,
}: {
  path: WorkingTreeChangedPathData;
  data: WorkingTreeImpactData;
}) {
  const resolution = resolvePathState(path, data);
  const target = data.resolvedTargets.find(
    (item) =>
      item.side === 'before' && (item.path === path.path || item.previousPath === path.path),
  );
  const stage = path.untracked
    ? 'Untracked'
    : path.staged && path.unstaged
      ? 'Staged + unstaged'
      : path.staged
        ? 'Staged'
        : path.unstaged
          ? 'Unstaged'
          : 'Git state unavailable';
  const marker = { added: '+', modified: '~', deleted: '-', renamed: 'R', 'type-changed': 'T' }[
    path.kind
  ];
  return (
    <div className="flex min-w-0 items-start gap-2 rounded border border-dna-border bg-dna-surface p-2 text-xs">
      <span
        aria-label={`${path.kind} change`}
        className="w-4 shrink-0 text-center font-semibold"
        role="img"
      >
        {marker}
      </span>
      <div className="min-w-0">
        <p className="break-words font-medium">{path.path}</p>
        {path.previousPath ? (
          <p className="break-words text-dna-muted">from {path.previousPath}</p>
        ) : null}
        <p className="mt-1 text-dna-muted">
          {stage} · {path.contentKind} · {resolution.label}
        </p>
        {path.kind === 'deleted' && target && !target.sourceAvailable ? (
          <p className="mt-1 text-dna-muted">
            Deleted source is unavailable; impact uses the retained baseline entity where possible.
          </p>
        ) : null}
        {path.staged ? (
          <p className="mt-1 text-dna-muted">
            Filesystem analysis reflects the current workspace file.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function UnresolvedPath({ item }: { item: WorkingTreeUnresolvedPathData }) {
  const messages: Record<WorkingTreeUnresolvedPathData['reason'], string> = {
    'analysis-refresh-required':
      'Current filesystem analysis does not include this path. Refresh Project DNA to resolve it.',
    'clean-baseline-unavailable': 'No clean HEAD-aligned baseline is available for this path.',
    'non-analyzable': 'This file type is not analyzed as source.',
    'missing-entity': 'The path was analyzed, but no canonical file entity was found.',
  } as Record<WorkingTreeUnresolvedPathData['reason'], string>;
  return (
    <div className="rounded border border-dna-border p-2 text-xs">
      <p className="break-words font-medium">
        {item.path} · {item.side === 'before' ? 'Before baseline' : 'After analysis'}
      </p>
      <p className="mt-1 text-dna-muted">{messages[item.reason]}</p>
    </div>
  );
}

function Notice({
  title,
  children,
  role,
  error = false,
  headingRef,
}: {
  title: string;
  children: ReactNode;
  role: 'status' | 'alert';
  error?: boolean;
  headingRef?: RefObject<HTMLHeadingElement>;
}) {
  return (
    <section
      aria-live={error ? 'assertive' : 'polite'}
      className={`mt-4 rounded border border-dna-border p-3 text-sm ${error ? 'text-error' : ''}`}
      role={role}
    >
      <h2 className="font-semibold" ref={headingRef} tabIndex={-1}>
        {title}
      </h2>
      <div className="mt-1 space-y-1 text-xs">{children}</div>
    </section>
  );
}

type ResolutionState =
  | 'fully-resolved'
  | 'before-resolved-after-unresolved'
  | 'before-unresolved-after-resolved'
  | 'unresolved'
  | 'not-applicable';

function resolvePathState(
  path: WorkingTreeChangedPathData,
  data: WorkingTreeImpactData,
): { state: ResolutionState; label: string } {
  const beforeApplicable = path.kind !== 'added';
  const afterApplicable = path.kind !== 'deleted';
  const beforeResolved = beforeApplicable && hasResolvedSide(path, data, 'before');
  const afterResolved = afterApplicable && hasResolvedSide(path, data, 'after');
  if (!beforeApplicable && !afterApplicable)
    return { state: 'not-applicable', label: 'Not applicable' };
  if (beforeResolved && afterResolved)
    return { state: 'fully-resolved', label: 'Before resolved / After resolved' };
  if (beforeResolved && afterApplicable)
    return {
      state: 'before-resolved-after-unresolved',
      label: 'Before resolved; after unresolved',
    };
  if (afterResolved && beforeApplicable)
    return {
      state: 'before-unresolved-after-resolved',
      label: 'Before unresolved; after resolved',
    };
  if (!beforeApplicable) {
    return afterResolved
      ? {
          state: 'before-unresolved-after-resolved',
          label: 'Before not applicable; after resolved',
        }
      : {
          state: 'before-unresolved-after-resolved',
          label: 'Before not applicable; after unresolved',
        };
  }
  if (!afterApplicable) {
    return beforeResolved
      ? {
          state: 'before-resolved-after-unresolved',
          label: 'Before resolved; after not applicable',
        }
      : {
          state: 'before-resolved-after-unresolved',
          label: 'Before unresolved; after not applicable',
        };
  }
  return { state: 'unresolved', label: 'Before unresolved / After unresolved' };
}

function hasResolvedSide(
  path: WorkingTreeChangedPathData,
  data: WorkingTreeImpactData,
  side: 'before' | 'after',
): boolean {
  return data.resolvedTargets.some(
    (item) => item.side === side && (item.path === path.path || item.previousPath === path.path),
  );
}
