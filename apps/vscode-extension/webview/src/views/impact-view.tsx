import { useState, type ReactNode } from 'react';
import type {
  ImpactResultData,
  ImpactTargetData,
  WorkspaceRelativePath,
} from '@project-dna/shared';
import { EmptyCollection, MetricCard, Section } from '../components/ui';
import { Panel } from '@project-dna/ui-components';

export function ImpactView({
  state,
  onCancel,
  onSelectEntity,
  onOpenWorkspaceTarget,
}: {
  state: {
    status: 'idle' | 'loading' | 'ready' | 'error' | 'cancelled';
    target: ImpactTargetData | null;
    result: ImpactResultData | null;
    error: string | null;
  };
  onCancel: () => void;
  onSelectEntity: (entityId: string) => void;
  onOpenWorkspaceTarget: (path: WorkspaceRelativePath) => void;
}) {
  if (state.status === 'idle') return null;
  if (state.status === 'loading')
    return (
      <section
        aria-live="polite"
        role="status"
        className="mt-4 rounded border border-dna-border bg-dna-surface p-3"
      >
        <h2 className="text-sm font-semibold">Impact analysis</h2>
        <p className="mt-2 text-xs text-dna-muted">Calculating downstream dependents…</p>
        <button
          className="mt-3 rounded border border-dna-border px-3 py-1.5 text-xs"
          onClick={onCancel}
          type="button"
        >
          Cancel
        </button>
      </section>
    );
  if (state.status === 'cancelled')
    return (
      <section
        aria-live="polite"
        className="mb-4 rounded border border-dna-border bg-dna-surface p-3 text-sm"
        role="status"
      >
        Impact analysis cancelled.
      </section>
    );
  if (state.status === 'error' || !state.result)
    return (
      <section
        aria-live="assertive"
        role="alert"
        className="mt-4 rounded border border-error p-3 text-sm text-error"
      >
        <h2 className="font-semibold">Impact unavailable</h2>
        <p className="mt-1">{state.error ?? 'Impact analysis unavailable.'}</p>
      </section>
    );
  return (
    <ImpactResultView
      result={state.result}
      onSelectEntity={onSelectEntity}
      onOpenWorkspaceTarget={onOpenWorkspaceTarget}
    />
  );
}

export function ImpactResultView({
  result,
  onSelectEntity,
  onOpenWorkspaceTarget,
}: {
  result: ImpactResultData;
  onSelectEntity: (entityId: string) => void;
  onOpenWorkspaceTarget: (path: WorkspaceRelativePath) => void;
}) {
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const severity = scoreSeverity(result.score.total);
  const targetLabel = result.target.path ?? result.target.name;
  const allEntities = [...result.directImpactedEntities, ...result.transitiveImpactedEntities];
  return (
    <div className="mt-4 pb-4">
      <section className="rounded border border-dna-border bg-dna-surface p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-dna-muted">Impact</p>
        <h2 className="mt-1 truncate text-sm font-semibold" title={targetLabel}>
          {targetLabel}
        </h2>
        <div className="mt-3 flex items-end justify-between gap-3">
          <div>
            <p className="text-xs text-dna-muted">Blast radius</p>
            <p className="text-2xl font-semibold">
              {Math.round(result.score.total)}
              <span className="text-sm text-dna-muted"> / 100</span>
            </p>
          </div>
          <Severity score={result.score.total} severity={severity} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <MetricCard
            className="border-dna-border bg-dna-background"
            label="Direct"
            value={result.directImpactedEntities.length}
          />
          <MetricCard
            className="border-dna-border bg-dna-background"
            label="Transitive"
            value={result.transitiveImpactedEntities.length}
          />
        </div>
      </section>
      <Panel title="Why this score" collapsible>
        <div className="space-y-2">
          {result.score.components.map((component) => (
            <div className="rounded border border-dna-border p-2" key={component.kind}>
              <div className="flex justify-between gap-2 text-xs">
                <span>{format(component.kind)}</span>
                <strong>+{component.contribution.toFixed(1)}</strong>
              </div>
              <p className="mt-1 text-xs text-dna-muted">
                {component.status} · {Math.round(component.normalizedValue * 100)}% normalized ·
                weight {Math.round(component.weight * 100)}%
              </p>
            </div>
          ))}
        </div>
      </Panel>
      <ListSection
        title="Direct dependents"
        items={result.directImpactedEntities}
        onSelectEntity={onSelectEntity}
        onOpenWorkspaceTarget={onOpenWorkspaceTarget}
      />
      <ListSection
        title="Transitive dependents"
        items={result.transitiveImpactedEntities}
        onSelectEntity={onSelectEntity}
        onOpenWorkspaceTarget={onOpenWorkspaceTarget}
      />
      <EffectSection
        title="Affected domains"
        empty="No affected domains were found."
        isEmpty={result.semanticEffects.domains.length === 0}
      >
        {result.semanticEffects.domains.map((item) => (
          <Effect
            key={item.id}
            title={item.name}
            detail={`${item.entityCount} entities · ${Math.round(item.confidence * 100)}% confidence`}
          />
        ))}
      </EffectSection>
      <EffectSection
        title="Capabilities"
        empty="No affected capabilities were found."
        isEmpty={result.semanticEffects.capabilities.length === 0}
      >
        {result.semanticEffects.capabilities.map((item) => (
          <Effect
            key={item.id}
            title={item.name}
            detail={`${format(item.category)} · ${item.implementationCount} implementations`}
          />
        ))}
      </EffectSection>
      <EffectSection
        title="Critical components"
        empty="No critical components were exposed."
        isEmpty={result.semanticEffects.criticalComponents.length === 0}
      >
        {result.semanticEffects.criticalComponents.map((item) => (
          <Effect
            key={item.id}
            title={item.name}
            detail={`${format(item.criticality)} · ${item.reason}`}
          />
        ))}
      </EffectSection>
      <EffectSection
        title="Risks"
        empty="No retained risks affect this blast radius."
        isEmpty={result.semanticEffects.risks.length === 0}
      >
        {result.semanticEffects.risks.map((item) => (
          <Effect
            key={item.id}
            title={`${format(item.severity)} · ${format(item.type)}`}
            detail={item.description}
          />
        ))}
      </EffectSection>
      <EffectSection
        title="Architecture impact"
        empty="No architecture layers or boundaries were affected."
        isEmpty={
          result.semanticEffects.architecture.layers.length === 0 &&
          result.semanticEffects.architecture.boundaryCrossings.length === 0
        }
      >
        {result.semanticEffects.architecture.layers.map((item) => (
          <Effect
            key={`${item.role}:${item.name}`}
            title={item.name}
            detail={`${format(item.role)} · ${item.fileCount} files`}
          />
        ))}
        {result.semanticEffects.architecture.boundaryCrossings.map((item) => (
          <Effect
            key={`${item.dependentId}-${item.dependencyId}`}
            title={`${item.fromLayer} → ${item.toLayer}`}
            detail={`${item.dependencyId} → ${item.dependentId}`}
          />
        ))}
      </EffectSection>
      <Panel title="Evidence and paths">
        <button
          aria-expanded={evidenceOpen}
          className="mb-2 rounded border border-dna-border px-2 py-1 text-xs"
          onClick={() => setEvidenceOpen((open) => !open)}
          type="button"
        >
          {evidenceOpen ? 'Hide evidence' : `Show evidence (${result.evidence.length})`}
        </button>
        {evidenceOpen ? (
          <div className="space-y-2">
            {result.canonicalPaths.map((path) => (
              <div
                className="rounded border border-dna-border p-2 text-xs"
                key={`path:${path.impactedEntityId}`}
              >
                <p className="font-medium">Canonical shortest path</p>
                <p className="mt-1 break-words text-dna-muted">{path.nodeIds.join(' → ')}</p>
              </div>
            ))}
            {result.evidence.map((item) => (
              <div className="rounded border border-dna-border p-2 text-xs" key={item.id}>
                <p className="font-medium">{format(item.reason)}</p>
                <p className="mt-1 text-dna-muted">{item.sourcePath ?? item.entityId}</p>
                {item.sourcePath ? (
                  <button
                    className="mt-2 rounded border border-dna-border px-2 py-1 hover:bg-dna-surface-hover"
                    onClick={() => onOpenWorkspaceTarget(item.sourcePath!)}
                    type="button"
                  >
                    Open source
                  </button>
                ) : null}
                {item.path ? (
                  <p className="mt-1 break-words text-dna-muted">{item.path.nodeIds.join(' → ')}</p>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </Panel>
      {result.warnings.length || result.truncations.length || !result.complete ? (
        <section aria-live="polite" className="rounded border border-dna-border bg-dna-surface p-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide">Warnings</h3>
          {result.warnings.map((warning) => (
            <p className="mt-1 text-xs text-dna-muted" key={warning}>
              {warning}
            </p>
          ))}
          {result.truncations.map((item) => (
            <p className="mt-1 text-xs text-dna-muted" key={`${item.kind}-${item.limit}`}>
              Truncated at {format(item.kind)} (limit {item.limit}).
            </p>
          ))}
          {!result.complete ? (
            <p className="mt-1 text-xs text-dna-muted">This result is incomplete.</p>
          ) : null}
        </section>
      ) : null}
      <p className="mt-2 text-xs text-dna-muted">
        {allEntities.length} affected entities · analysis v{result.analysisVersion}
      </p>
    </div>
  );
}

function ListSection({
  title,
  items,
  onSelectEntity,
  onOpenWorkspaceTarget,
}: {
  title: string;
  items: ImpactResultData['directImpactedEntities'];
  onSelectEntity: (entityId: string) => void;
  onOpenWorkspaceTarget: (path: WorkspaceRelativePath) => void;
}) {
  return (
    <Section title={title}>
      {items.length === 0 ? (
        <EmptyCollection>No {title.toLowerCase()} found.</EmptyCollection>
      ) : (
        <div className="space-y-1">
          {items.map((item) => (
            <div className="rounded border border-dna-border bg-dna-surface p-2" key={item.id}>
              <span className="block truncate text-xs font-medium">{item.name}</span>
              <span className="block truncate text-xs text-dna-muted">
                {item.path ?? item.id} · depth {item.minimumDepth}
              </span>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  className="rounded border border-dna-border px-2 py-1 text-xs hover:bg-dna-surface-hover"
                  onClick={() => onSelectEntity(item.id)}
                  type="button"
                >
                  Details
                </button>
                {item.path ? (
                  <button
                    className="rounded border border-dna-border px-2 py-1 text-xs hover:bg-dna-surface-hover"
                    onClick={() => onOpenWorkspaceTarget(item.path!)}
                    type="button"
                  >
                    Open source
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}
function EffectSection({
  title,
  empty,
  isEmpty,
  children,
}: {
  title: string;
  empty: string;
  isEmpty: boolean;
  children: ReactNode;
}) {
  return (
    <Section title={title}>
      {isEmpty ? (
        <EmptyCollection>{empty}</EmptyCollection>
      ) : (
        <div className="space-y-1">{children}</div>
      )}
    </Section>
  );
}
function Effect({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded border border-dna-border bg-dna-surface p-2">
      <p className="text-xs font-medium">{title}</p>
      <p className="mt-1 text-xs text-dna-muted">{detail}</p>
    </div>
  );
}
function Severity({ severity, score }: { severity: string; score: number }) {
  const colors: Record<string, string> = {
    Low: 'bg-[var(--vscode-testing-iconPassed)]',
    Medium: 'bg-[var(--vscode-editorWarning-foreground)]',
    High: 'bg-[var(--vscode-charts-orange,#f59e0b)]',
    Critical: 'bg-[var(--vscode-editorError-foreground)]',
  };
  return (
    <div className="w-24 shrink-0">
      <span className="text-xs font-medium">{severity}</span>
      <div
        aria-label={`Impact severity: ${severity}, ${Math.round(score)} out of 100`}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={score}
        className="mt-1 h-1.5 overflow-hidden rounded bg-dna-surface-hover"
        role="progressbar"
      >
        <div className={`h-full ${colors[severity]}`} style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}
function scoreSeverity(score: number): string {
  if (score >= 75) return 'Critical';
  if (score >= 50) return 'High';
  if (score >= 25) return 'Medium';
  return 'Low';
}
function format(value: string): string {
  return value.replaceAll('-', ' ').replace(/\b\w/gu, (character) => character.toUpperCase());
}
