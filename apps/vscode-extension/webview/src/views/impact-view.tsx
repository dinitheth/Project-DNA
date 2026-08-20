import { useState, type ReactNode } from 'react';
import type {
  ImpactResultData,
  ImpactTargetData,
  WorkspaceRelativePath,
} from '@project-dna/shared';
import { EmptyCollection, MetricCard, Section } from '../components/ui';
import { Panel } from '@project-dna/ui-components';

export interface NavigationFeedback {
  readonly requestId: number;
  readonly path: WorkspaceRelativePath;
  readonly outcome: 'opened' | 'missing' | 'rejected' | 'failed';
  readonly message: string | null;
}

export function ImpactView({
  state,
  onCancel,
  onSelectEntity,
  onOpenWorkspaceTarget,
  navigationFeedback,
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
  navigationFeedback?: NavigationFeedback | null;
}) {
  const feedback = navigationFeedback ? (
    <NavigationFeedbackView feedback={navigationFeedback} />
  ) : null;
  if (state.status === 'idle') return feedback;
  if (state.status === 'loading')
    return (
      <>
        {feedback}
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
      </>
    );
  if (state.status === 'cancelled')
    return (
      <>
        {feedback}
        <section
          aria-live="polite"
          className="mb-4 rounded border border-dna-border bg-dna-surface p-3 text-sm"
          role="status"
        >
          Impact analysis cancelled.
        </section>
      </>
    );
  if (state.status === 'error' || !state.result)
    return (
      <>
        {feedback}
        <section
          aria-live="assertive"
          role="alert"
          className="mt-4 rounded border border-error p-3 text-sm text-error"
        >
          <h2 className="font-semibold">Impact unavailable</h2>
          <p className="mt-1">{state.error ?? 'Impact analysis unavailable.'}</p>
        </section>
      </>
    );
  return (
    <>
      {feedback}
      <ImpactResultView
        result={state.result}
        onSelectEntity={onSelectEntity}
        onOpenWorkspaceTarget={onOpenWorkspaceTarget}
      />
    </>
  );
}

export function ImpactResultView({
  result,
  onSelectEntity,
  onOpenWorkspaceTarget,
  historical = false,
}: {
  result: ImpactResultData;
  onSelectEntity: (entityId: string) => void;
  onOpenWorkspaceTarget: (path: WorkspaceRelativePath) => void;
  historical?: boolean;
}) {
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const severity = scoreSeverity(result.score.total);
  const targetLabel = result.target.path ?? result.target.name;
  const allEntities = [...result.directImpactedEntities, ...result.transitiveImpactedEntities];
  const semanticUnavailable = semanticUnavailableMessages(result.warnings);
  const domainsUnavailable = hasSemanticWarning(result.warnings, 'domains unavailable');
  const capabilitiesUnavailable = hasSemanticWarning(result.warnings, 'capabilities unavailable');
  const criticalUnavailable = hasSemanticWarning(
    result.warnings,
    'critical components unavailable',
  );
  const risksUnavailable = hasSemanticWarning(result.warnings, 'risks unavailable');
  const architectureUnavailable =
    hasSemanticWarning(result.warnings, 'architecture layers unavailable') ||
    hasSemanticWarning(result.warnings, 'entities unavailable for layer membership');
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
          <MetricCard
            className="border-dna-border bg-dna-background"
            label="Domains"
            value={result.semanticEffects.domains.length}
          />
          <MetricCard
            className="border-dna-border bg-dna-background"
            label="Risks"
            value={result.semanticEffects.risks.length}
          />
          <MetricCard
            className="border-dna-border bg-dna-background"
            label="Critical"
            value={result.semanticEffects.criticalComponents.length}
          />
          <MetricCard
            className="border-dna-border bg-dna-background"
            label="Boundaries"
            value={result.semanticEffects.architecture.boundaryCrossings.length}
          />
        </div>
      </section>
      {historical ? (
        <NoticeSection title="Historical source">
          <p className="text-xs text-dna-muted">
            Historical source was available for analysis; current workspace navigation is
            unavailable.
          </p>
        </NoticeSection>
      ) : null}
      <ListSection
        allowNavigation={!historical}
        title="Direct dependents"
        items={result.directImpactedEntities}
        onSelectEntity={onSelectEntity}
        onOpenWorkspaceTarget={onOpenWorkspaceTarget}
      />
      <ListSection
        allowNavigation={!historical}
        title="Transitive dependents"
        items={result.transitiveImpactedEntities}
        onSelectEntity={onSelectEntity}
        onOpenWorkspaceTarget={onOpenWorkspaceTarget}
      />
      <Panel defaultOpen={false} title="Why this score" collapsible>
        <div className="space-y-2">
          {result.score.components.map((component) => (
            <div className="rounded border border-dna-border p-2" key={component.kind}>
              <div className="flex justify-between gap-2 text-xs">
                <span>{scoreComponentLabel(component.kind)}</span>
                <strong>+{component.contribution.toFixed(1)}</strong>
              </div>
              <p className="mt-1 text-xs text-dna-muted">
                Raw input: {component.rawInput} · normalized{' '}
                {Math.round(component.normalizedValue * 100)}%{' · '}weight{' '}
                {Math.round(component.weight * 100)}% · {component.status}
              </p>
            </div>
          ))}
        </div>
      </Panel>
      <EffectSection
        title="Affected domains"
        empty={
          domainsUnavailable
            ? 'Domain analysis unavailable; no conclusion about affected domains can be made.'
            : 'No affected domains were found.'
        }
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
        empty={
          capabilitiesUnavailable
            ? 'Capability analysis unavailable; no conclusion about affected capabilities can be made.'
            : 'No affected capabilities were found.'
        }
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
        empty={
          criticalUnavailable
            ? 'Critical-component analysis unavailable; no conclusion about critical exposure can be made.'
            : 'No critical components were exposed.'
        }
        isEmpty={result.semanticEffects.criticalComponents.length === 0}
      >
        {result.semanticEffects.criticalComponents.map((item) => (
          <Effect
            key={item.id}
            title={item.name}
            detail={`${format(item.criticality)} · ${item.reason}`}
            path={item.path}
            onOpenWorkspaceTarget={historical ? undefined : onOpenWorkspaceTarget}
          />
        ))}
      </EffectSection>
      <EffectSection
        title="Risks"
        empty={
          risksUnavailable
            ? 'Risk analysis unavailable; no conclusion about affected risks can be made.'
            : 'No retained risks affect this blast radius.'
        }
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
        empty={
          architectureUnavailable
            ? 'Architecture analysis unavailable; no conclusion about layer impact can be made.'
            : 'No architecture layers or boundaries were affected.'
        }
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
                <p className="mt-1 break-words text-dna-muted" title={path.nodeIds.join(' → ')}>
                  {path.nodeIds.join(' → ')}
                </p>
              </div>
            ))}
            {result.evidence.map((item) => (
              <div className="rounded border border-dna-border p-2 text-xs" key={item.id}>
                <p className="font-medium">{format(item.reason)}</p>
                <p
                  className="mt-1 break-words text-dna-muted"
                  title={item.sourcePath ?? item.entityId}
                >
                  {item.sourcePath ?? item.entityId}
                </p>
                {item.sourcePath ? (
                  historical ? (
                    <p className="mt-1 text-xs text-dna-muted">
                      Historical path; current workspace navigation unavailable.
                    </p>
                  ) : (
                    <SourceNavigationButton
                      onOpenWorkspaceTarget={onOpenWorkspaceTarget}
                      path={item.sourcePath}
                    />
                  )
                ) : null}
                {item.path ? (
                  <p
                    className="mt-1 break-words text-dna-muted"
                    title={item.path.nodeIds.join(' → ')}
                  >
                    {item.path.nodeIds.join(' → ')}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </Panel>
      {result.truncations.length > 0 ? (
        <NoticeSection title="Traversal limited">
          <p className="text-xs text-dna-muted">
            The displayed dependent set may not be exhaustive.
          </p>
          {result.truncations.map((item) => (
            <p className="mt-1 text-xs text-dna-muted" key={`${item.kind}-${item.limit}`}>
              {truncationMessage(item.kind, item.limit)}
            </p>
          ))}
        </NoticeSection>
      ) : null}
      {semanticUnavailable.length > 0 ? (
        <NoticeSection title="Semantic evidence incomplete">
          {semanticUnavailable.map((warning) => (
            <p className="mt-1 text-xs text-dna-muted" key={warning}>
              {warning}
            </p>
          ))}
        </NoticeSection>
      ) : null}
      {result.warnings.filter((warning) => !warning.startsWith('Semantic enrichment incomplete:'))
        .length > 0 ? (
        <NoticeSection title="Additional notes">
          {result.warnings
            .filter((warning) => !warning.startsWith('Semantic enrichment incomplete:'))
            .map((warning) => (
              <p className="mt-1 text-xs text-dna-muted" key={warning}>
                {warning}
              </p>
            ))}
          {!result.complete && result.truncations.length === 0 ? (
            <p className="mt-1 text-xs text-dna-muted">This result is incomplete.</p>
          ) : null}
        </NoticeSection>
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
  allowNavigation = true,
}: {
  title: string;
  items: ImpactResultData['directImpactedEntities'];
  onSelectEntity: (entityId: string) => void;
  onOpenWorkspaceTarget: (path: WorkspaceRelativePath) => void;
  allowNavigation?: boolean;
}) {
  return (
    <Section title={title}>
      {items.length === 0 ? (
        <EmptyCollection>No {title.toLowerCase()} found.</EmptyCollection>
      ) : (
        <div className="space-y-1">
          {items.map((item) => (
            <div className="rounded border border-dna-border bg-dna-surface p-2" key={item.id}>
              <span className="block truncate text-xs font-medium" title={item.name}>
                {item.name}
              </span>
              <span
                className="block break-words text-xs text-dna-muted"
                title={item.path ?? item.id}
              >
                {item.path ?? item.id} · depth {item.minimumDepth}
              </span>
              {allowNavigation ? (
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
              ) : (
                <p className="mt-2 text-xs text-dna-muted">
                  Historical entity; current workspace actions unavailable.
                </p>
              )}
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
function Effect({
  title,
  detail,
  path,
  onOpenWorkspaceTarget,
}: {
  title: string;
  detail: string;
  path?: WorkspaceRelativePath;
  onOpenWorkspaceTarget?: (path: WorkspaceRelativePath) => void;
}) {
  return (
    <div className="rounded border border-dna-border bg-dna-surface p-2">
      <p className="break-words text-xs font-medium" title={title}>
        {title}
      </p>
      <p className="mt-1 break-words text-xs text-dna-muted" title={detail}>
        {detail}
      </p>
      {path && onOpenWorkspaceTarget ? (
        <SourceNavigationButton onOpenWorkspaceTarget={onOpenWorkspaceTarget} path={path} />
      ) : null}
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
        <div
          className={`h-full ${colors[severity]}`}
          style={{ width: `${Math.min(100, Math.max(0, score))}%` }}
        />
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

function scoreComponentLabel(kind: string): string {
  return (
    {
      'dependency-reach': 'Dependency reach · downstream entity count',
      'critical-component-exposure': 'Critical exposure · critical-component exposure',
      'domain-reach': 'Domain reach · affected domain count',
      'risk-exposure': 'Risk exposure',
      'architecture-boundaries': 'Architecture boundaries · boundary count',
    }[kind] ?? format(kind)
  );
}

function truncationMessage(kind: string, limit: number): string {
  return (
    {
      'max-depth': `Depth bound reached at ${limit}; deeper dependents are omitted.`,
      'max-entities': `Entity bound reached at ${limit}; additional dependents are omitted.`,
      'max-evidence-paths': `Evidence bound reached at ${limit}; additional paths are omitted.`,
    }[kind] ?? `Traversal bound reached at ${limit}.`
  );
}

function semanticUnavailableMessages(warnings: readonly string[]): string[] {
  const messages: string[] = [];
  const mapping: Array<[string, string]> = [
    [
      'domains unavailable',
      'Domain analysis unavailable; no conclusion about affected domains can be made.',
    ],
    [
      'capabilities unavailable',
      'Capability analysis unavailable; no conclusion about affected capabilities can be made.',
    ],
    [
      'critical components unavailable',
      'Critical-component analysis unavailable; no conclusion about critical exposure can be made.',
    ],
    [
      'risks unavailable',
      'Risk analysis unavailable; no conclusion about affected risks can be made.',
    ],
    [
      'architecture layers unavailable',
      'Architecture analysis unavailable; no conclusion about layer impact can be made.',
    ],
    [
      'entities unavailable for layer membership',
      'Architecture membership data unavailable; no conclusion about layer impact can be made.',
    ],
    [
      'canonical paths unavailable',
      'Canonical paths unavailable; architecture boundary evidence may be incomplete.',
    ],
  ];
  for (const [needle, message] of mapping) {
    if (warnings.some((warning) => warning.includes(needle))) messages.push(message);
  }
  return messages;
}

function hasSemanticWarning(warnings: readonly string[], needle: string): boolean {
  return warnings.some(
    (warning) => warning.startsWith('Semantic enrichment incomplete:') && warning.includes(needle),
  );
}

export function SourceNavigationButton({
  path,
  onOpenWorkspaceTarget,
}: {
  path: WorkspaceRelativePath;
  onOpenWorkspaceTarget: (path: WorkspaceRelativePath) => void;
}) {
  return (
    <button
      className="mt-2 rounded border border-dna-border px-2 py-1 text-xs hover:bg-dna-surface-hover"
      onClick={() => onOpenWorkspaceTarget(path)}
      type="button"
    >
      Open source
    </button>
  );
}

function NoticeSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-live="polite" className="rounded border border-dna-border bg-dna-surface p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide">{title}</h3>
      {children}
    </section>
  );
}

function NavigationFeedbackView({ feedback }: { feedback: NavigationFeedback }) {
  const labels = {
    opened: 'Source opened',
    missing: 'Source missing',
    rejected: 'Source navigation rejected',
    failed: 'Source navigation failed',
  } as const;
  const tone = feedback.outcome === 'opened' ? 'text-dna-foreground' : 'text-error';
  return (
    <section
      aria-live="polite"
      className="mb-3 rounded border border-dna-border bg-dna-surface p-2 text-xs"
      role="status"
    >
      <p className={`font-medium ${tone}`}>{labels[feedback.outcome]}</p>
      <p className="mt-1 break-words text-dna-muted" title={feedback.path}>
        {feedback.path}
      </p>
      {feedback.message ? (
        <p className="mt-1 break-words text-dna-muted">{feedback.message}</p>
      ) : null}
    </section>
  );
}
