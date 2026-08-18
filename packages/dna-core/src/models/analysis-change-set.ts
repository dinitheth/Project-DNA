import { z } from 'zod';
import {
  AnalysisStateRelationshipSchema,
  AnalysisStateViewSchema,
  type AnalysisStateRelationship,
  type AnalysisStateView,
} from './analysis-state-view.js';

export const AnalysisValueChangeSchema = z.object({
  field: z.string(),
  from: z.unknown(),
  to: z.unknown(),
});
export type AnalysisValueChange = z.infer<typeof AnalysisValueChangeSchema>;

const IdentifiedChangeSchema = z.object({
  id: z.string(),
  changes: z.array(AnalysisValueChangeSchema),
});

const MembershipChangeSchema = z.object({
  entityId: z.string(),
  from: z.string().nullable(),
  to: z.string().nullable(),
});

export const AnalysisChangeSetSchema = z.object({
  fromVersion: z.number().int().nonnegative(),
  toVersion: z.number().int().nonnegative(),
  addedEntityIds: z.array(z.string()),
  removedEntityIds: z.array(z.string()),
  modifiedEntities: z.array(IdentifiedChangeSchema),
  addedRelationships: z.array(AnalysisStateRelationshipSchema),
  removedRelationships: z.array(AnalysisStateRelationshipSchema),
  modifiedRelationships: z.array(
    z.object({
      sourceId: z.string(),
      targetId: z.string(),
      changes: z.array(AnalysisValueChangeSchema),
    }),
  ),
  addedDomainIds: z.array(z.string()),
  removedDomainIds: z.array(z.string()),
  modifiedDomains: z.array(IdentifiedChangeSchema),
  addedRiskIds: z.array(z.string()),
  resolvedRiskIds: z.array(z.string()),
  modifiedRisks: z.array(IdentifiedChangeSchema),
  domainMembershipChanges: z.array(MembershipChangeSchema),
  architectureMembershipChanges: z.array(MembershipChangeSchema),
  unavailableCollections: z.array(z.enum(['domains', 'risks', 'architecture'])),
});
export type AnalysisChangeSet = Readonly<z.infer<typeof AnalysisChangeSetSchema>>;

/** Compare two canonical states without depending on graph or storage insertion order. */
export function createAnalysisChangeSet(
  fromState: AnalysisStateView,
  toState: AnalysisStateView,
): AnalysisChangeSet {
  const from = AnalysisStateViewSchema.parse(fromState);
  const to = AnalysisStateViewSchema.parse(toState);
  const entityChanges = compareIdentified(from.entities, to.entities);
  const relationshipChanges = compareRelationships(
    from.structuralRelationships,
    to.structuralRelationships,
  );
  const domainChanges = compareOptionalIdentified(from.domains, to.domains);
  const riskChanges = compareOptionalIdentified(from.risks, to.risks);
  const unavailableCollections = [
    ...(from.domains === null || to.domains === null ? (['domains'] as const) : []),
    ...(from.risks === null || to.risks === null ? (['risks'] as const) : []),
    ...(from.architecture === null || to.architecture === null ? (['architecture'] as const) : []),
  ];

  return deepFreeze(
    AnalysisChangeSetSchema.parse({
      fromVersion: from.analysisVersion,
      toVersion: to.analysisVersion,
      addedEntityIds: entityChanges.added,
      removedEntityIds: entityChanges.removed,
      modifiedEntities: entityChanges.modified,
      addedRelationships: relationshipChanges.added,
      removedRelationships: relationshipChanges.removed,
      modifiedRelationships: relationshipChanges.modified,
      addedDomainIds: domainChanges.added,
      removedDomainIds: domainChanges.removed,
      modifiedDomains: domainChanges.modified,
      addedRiskIds: riskChanges.added,
      resolvedRiskIds: riskChanges.removed,
      modifiedRisks: riskChanges.modified,
      domainMembershipChanges: membershipChanges(from.entities, to.entities, 'belongsToDomain'),
      architectureMembershipChanges: membershipChanges(
        from.entities,
        to.entities,
        'belongsToLayer',
      ),
      unavailableCollections,
    }),
  );
}

export function serializeAnalysisChangeSet(changeSet: AnalysisChangeSet): string {
  return JSON.stringify(AnalysisChangeSetSchema.parse(changeSet));
}

interface IdentifiedValue {
  readonly id: string;
}

interface ComparedIdentified {
  readonly added: string[];
  readonly removed: string[];
  readonly modified: Array<{ id: string; changes: AnalysisValueChange[] }>;
}

function compareOptionalIdentified<T extends IdentifiedValue>(
  from: readonly T[] | null,
  to: readonly T[] | null,
): ComparedIdentified {
  return from === null || to === null
    ? { added: [], removed: [], modified: [] }
    : compareIdentified(from, to);
}

function compareIdentified<T extends IdentifiedValue>(
  from: readonly T[],
  to: readonly T[],
): ComparedIdentified {
  const fromById = new Map(from.map((value) => [value.id, value]));
  const toById = new Map(to.map((value) => [value.id, value]));
  const added = [...toById.keys()].filter((id) => !fromById.has(id)).sort(compareStrings);
  const removed = [...fromById.keys()].filter((id) => !toById.has(id)).sort(compareStrings);
  const modified = [...fromById.keys()]
    .filter((id) => toById.has(id))
    .sort(compareStrings)
    .flatMap((id) => {
      const changes = compareFields(fromById.get(id)!, toById.get(id)!);
      return changes.length === 0 ? [] : [{ id, changes }];
    });
  return { added, removed, modified };
}

function compareRelationships(
  from: readonly AnalysisStateRelationship[],
  to: readonly AnalysisStateRelationship[],
): {
  added: AnalysisStateRelationship[];
  removed: AnalysisStateRelationship[];
  modified: Array<{
    sourceId: string;
    targetId: string;
    changes: AnalysisValueChange[];
  }>;
} {
  const fromByKey = new Map(from.map((value) => [relationshipKey(value), value]));
  const toByKey = new Map(to.map((value) => [relationshipKey(value), value]));
  const added = [...toByKey.entries()]
    .filter(([key]) => !fromByKey.has(key))
    .map(([, value]) => value)
    .sort(compareRelationship);
  const removed = [...fromByKey.entries()]
    .filter(([key]) => !toByKey.has(key))
    .map(([, value]) => value)
    .sort(compareRelationship);
  const modified = [...fromByKey.keys()]
    .filter((key) => toByKey.has(key))
    .sort(compareStrings)
    .flatMap((key) => {
      const previous = fromByKey.get(key)!;
      const changes = compareFields(previous.attributes, toByKey.get(key)!.attributes);
      return changes.length === 0
        ? []
        : [{ sourceId: previous.sourceId, targetId: previous.targetId, changes }];
    });
  return { added, removed, modified };
}

function membershipChanges(
  from: AnalysisStateView['entities'],
  to: AnalysisStateView['entities'],
  field: 'belongsToDomain' | 'belongsToLayer',
): Array<{ entityId: string; from: string | null; to: string | null }> {
  const fromById = new Map(from.map((entity) => [entity.id, entity]));
  return to
    .filter(
      (entity) => fromById.has(entity.id) && fromById.get(entity.id)![field] !== entity[field],
    )
    .map((entity) => ({
      entityId: entity.id,
      from: fromById.get(entity.id)![field],
      to: entity[field],
    }))
    .sort((left, right) => compareStrings(left.entityId, right.entityId));
}

function compareFields(from: object, to: object): AnalysisValueChange[] {
  const fromRecord = from as Record<string, unknown>;
  const toRecord = to as Record<string, unknown>;
  return [...new Set([...Object.keys(fromRecord), ...Object.keys(toRecord)])]
    .sort(compareStrings)
    .flatMap((field) =>
      stableValue(fromRecord[field]) === stableValue(toRecord[field])
        ? []
        : [{ field, from: fromRecord[field], to: toRecord[field] }],
    );
}

function stableValue(value: unknown): string {
  return JSON.stringify(canonicalComparisonValue(value));
}

function canonicalComparisonValue(value: unknown): unknown {
  if (value === undefined) return { $analysisStateUndefined: true };
  if (Array.isArray(value)) {
    return value.map(canonicalComparisonValue).sort(compareUnknown);
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort(compareStrings)
        .map((key) => [key, canonicalComparisonValue(value[key])]),
    );
  }
  return value;
}

function compareUnknown(left: unknown, right: unknown): number {
  return compareStrings(stableValue(left), stableValue(right));
}

function relationshipKey(value: AnalysisStateRelationship): string {
  return `${value.sourceId}\u0000${value.targetId}`;
}

function compareRelationship(
  left: AnalysisStateRelationship,
  right: AnalysisStateRelationship,
): number {
  return compareStrings(relationshipKey(left), relationshipKey(right));
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
  } else if (isRecord(value)) {
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return Object.freeze(value);
}
