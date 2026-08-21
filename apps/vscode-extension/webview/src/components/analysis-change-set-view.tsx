import { useId, useState } from 'react';
import type { CommitAnalysisChangeSetData } from '@project-dna/shared';

export function AnalysisChangeSetView({
  changeSet,
  title = 'Semantic change set',
}: {
  changeSet: CommitAnalysisChangeSetData | null;
  title?: string;
}) {
  const headingId = useId();
  if (!changeSet) {
    return (
      <section className="rounded border border-dna-border bg-dna-surface p-3" role="status">
        <h3 className="font-semibold text-dna-foreground">{title} unavailable</h3>
        <p className="mt-1 text-xs text-dna-muted">
          Before/after analysis was not available for deterministic comparison.
        </p>
      </section>
    );
  }
  const domainsUnavailable = changeSet.unavailableCollections.includes('domains');
  const risksUnavailable = changeSet.unavailableCollections.includes('risks');
  const architectureUnavailable = changeSet.unavailableCollections.includes('architecture');
  return (
    <section aria-labelledby={headingId}>
      <h3 className="mb-2 text-xs font-semibold uppercase text-dna-muted" id={headingId}>
        {title}
      </h3>
      <div className="space-y-2">
        <ChangeSection title="Entities added" items={changeSet.addedEntityIds} />
        <ChangeSection title="Entities removed" items={changeSet.removedEntityIds} />
        <ChangeSection
          title="Entities modified"
          items={changeSet.modifiedEntities.map(
            (item) => `${item.id}: ${changeFields(item.changes)}`,
          )}
        />
        <ChangeSection
          title="Relationships added"
          items={changeSet.addedRelationships.map(relationshipLabel)}
        />
        <ChangeSection
          title="Relationships removed"
          items={changeSet.removedRelationships.map(relationshipLabel)}
        />
        <ChangeSection
          title="Domain changes"
          unavailable={domainsUnavailable}
          items={[
            ...changeSet.addedDomainIds.map((id) => `Added: ${id}`),
            ...changeSet.removedDomainIds.map((id) => `Removed: ${id}`),
            ...changeSet.modifiedDomains.map((item) => `Modified: ${item.id}`),
            ...changeSet.domainMembershipChanges.map(
              (item) => `${item.entityId}: ${item.from ?? 'none'} -> ${item.to ?? 'none'}`,
            ),
          ]}
        />
        <ChangeSection
          title="Risk changes"
          unavailable={risksUnavailable}
          items={[
            ...changeSet.addedRiskIds.map((id) => `Added: ${id}`),
            ...changeSet.resolvedRiskIds.map((id) => `Resolved: ${id}`),
            ...changeSet.modifiedRisks.map(
              (item) => `Modified: ${item.id}: ${changeFields(item.changes)}`,
            ),
          ]}
        />
        <ChangeSection
          title="Architecture membership changes"
          unavailable={architectureUnavailable}
          items={changeSet.architectureMembershipChanges.map(
            (item) => `${item.entityId}: ${item.from ?? 'none'} -> ${item.to ?? 'none'}`,
          )}
        />
      </div>
    </section>
  );
}

function ChangeSection({
  title,
  items,
  unavailable = false,
}: {
  title: string;
  items: readonly string[];
  unavailable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const contentId = useId();
  const status = unavailable
    ? 'Unavailable'
    : items.length === 0
      ? 'No changes detected'
      : items.length;
  return (
    <section className="rounded border border-dna-border bg-dna-surface p-2">
      <button
        aria-controls={contentId}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 text-left text-xs"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <span className="font-medium">{title}</span>
        <span className="text-dna-muted">{status}</span>
      </button>
      <div hidden={!open} id={contentId}>
        {unavailable ? (
          <p className="mt-2 text-xs text-dna-muted">
            Semantic collection unavailable; this is not an empty result.
          </p>
        ) : items.length === 0 ? (
          <p className="mt-2 text-xs text-dna-muted">No changes detected.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-xs text-dna-muted">
            {items.map((item, index) => (
              <li className="break-all" key={`${index}:${item}`}>
                {item}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function relationshipLabel(item: { sourceId: string; targetId: string; type: string }): string {
  return `${item.sourceId} -> ${item.targetId} (${formatLabel(item.type)})`;
}

function changeFields(changes: readonly { field: string; from: string; to: string }[]): string {
  return changes.map((change) => `${change.field}: ${change.from} -> ${change.to}`).join(', ');
}

function formatLabel(value: string): string {
  return value.replaceAll('-', ' ').replace(/\b\w/gu, (letter) => letter.toUpperCase());
}
