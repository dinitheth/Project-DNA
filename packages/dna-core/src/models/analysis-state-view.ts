import { z } from 'zod';
import { ArchitectureDNASchema, type ArchitectureDNA } from './architecture-dna.js';
import { BusinessDomainSchema, type BusinessDomain } from './business-domain.js';
import { CapabilitySchema, type Capability } from './capability.js';
import { CriticalComponentSchema, type CriticalComponent } from './critical-component.js';
import { DNAObjectSchema, type DNAObject } from './dna-object.js';
import {
  RepositoryGraph,
  type GraphEdgeAttributes,
  type GraphNodeAttributes,
} from './repository-graph.js';
import type { DependencyGraphView } from '../graph/dependency-traversal.js';
import { RiskNodeSchema, type RiskNode } from './risk-node.js';

const ANALYSIS_GRAPH_VIEW_CACHE_LIMIT = 8;
const analysisGraphViewCache = new Map<
  string,
  { readonly state: AnalysisStateView; readonly view: DependencyGraphView }
>();

const GraphNodeAttributesSchema = z.object({
  kind: z.enum(['file', 'module', 'package', 'external']),
  label: z.string(),
  path: z.string().optional(),
  language: z.string().optional(),
  complexity: z.number().optional(),
  linesOfCode: z.number().optional(),
});

const GraphEdgeAttributesSchema = z.object({
  type: z.enum(['import', 're-export', 'dynamic-import', 'require', 'type-import']),
  isTypeOnly: z.boolean(),
  specifierCount: z.number().int().nonnegative(),
  isExternal: z.boolean(),
});

export const AnalysisStateNodeSchema = z.object({
  id: z.string(),
  attributes: GraphNodeAttributesSchema,
});
export type AnalysisStateNode = z.infer<typeof AnalysisStateNodeSchema>;

export const AnalysisStateRelationshipSchema = z.object({
  sourceId: z.string(),
  targetId: z.string(),
  attributes: GraphEdgeAttributesSchema,
});
export type AnalysisStateRelationship = z.infer<typeof AnalysisStateRelationshipSchema>;

export const AnalysisStateViewSchema = z.object({
  repositoryId: z.string(),
  analysisVersion: z.number().int().nonnegative(),
  entities: z.array(DNAObjectSchema),
  structuralNodes: z.array(AnalysisStateNodeSchema),
  structuralRelationships: z.array(AnalysisStateRelationshipSchema),
  domains: z.array(BusinessDomainSchema).nullable(),
  capabilities: z.array(CapabilitySchema).nullable(),
  criticalComponents: z.array(CriticalComponentSchema).nullable(),
  risks: z.array(RiskNodeSchema).nullable(),
  architecture: ArchitectureDNASchema.nullable(),
});
export type AnalysisStateView = Readonly<z.infer<typeof AnalysisStateViewSchema>>;

export interface AnalysisStateViewInput {
  readonly repositoryId: string;
  readonly analysisVersion: number;
  readonly entities: readonly DNAObject[];
  readonly graph: RepositoryGraph;
  readonly domains?: readonly BusinessDomain[] | null;
  readonly capabilities?: readonly Capability[] | null;
  readonly criticalComponents?: readonly CriticalComponent[] | null;
  readonly risks?: readonly RiskNode[] | null;
  readonly architecture?: ArchitectureDNA | null;
}

/** Create the canonical, immutable state shared by impact and evolution. */
export function createAnalysisStateView(input: AnalysisStateViewInput): AnalysisStateView {
  const structuralNodes: AnalysisStateNode[] = [];
  input.graph.forEachNode((id, attributes) => {
    structuralNodes.push({ id, attributes: cloneValue(attributes) });
  });
  const structuralRelationships: AnalysisStateRelationship[] = [];
  input.graph.forEachEdge((_edgeId, attributes, sourceId, targetId) => {
    structuralRelationships.push({
      sourceId,
      targetId,
      attributes: cloneValue(attributes),
    });
  });

  const parsed = AnalysisStateViewSchema.parse({
    repositoryId: input.repositoryId,
    analysisVersion: input.analysisVersion,
    entities: canonicalCollection(input.entities, (entity) => entity.id),
    structuralNodes: canonicalCollection(structuralNodes, (node) => node.id),
    structuralRelationships: canonicalCollection(structuralRelationships, relationshipIdentity),
    domains: canonicalNullableCollection(input.domains, (domain) => domain.id),
    capabilities: canonicalNullableCollection(input.capabilities, (capability) => capability.id),
    criticalComponents: canonicalNullableCollection(
      input.criticalComponents,
      (component) => component.id,
    ),
    risks: canonicalNullableCollection(input.risks, (risk) => risk.id),
    architecture:
      input.architecture === undefined || input.architecture === null
        ? null
        : canonicalValue(input.architecture),
  });
  const state = deepFreeze(canonicalValue(parsed));
  cacheAnalysisStateGraphView(state, buildAnalysisStateGraphView(state));
  return state;
}

/** Restore a private mutable graph from the immutable shared state DTO. */
export function createRepositoryGraphFromAnalysisState(state: AnalysisStateView): RepositoryGraph {
  const serialized = {
    attributes: {},
    nodes: state.structuralNodes.map((node) => ({
      key: node.id,
      attributes: cloneValue(node.attributes),
    })),
    edges: state.structuralRelationships.map((relationship, index) => ({
      key: `analysis-state-edge:${index}`,
      source: relationship.sourceId,
      target: relationship.targetId,
      attributes: cloneValue(relationship.attributes),
    })),
  };
  return RepositoryGraph.fromJSON(serialized);
}

/** Build a lightweight read-only traversal index without reconstructing Graphology. */
export function createAnalysisStateGraphView(state: AnalysisStateView): DependencyGraphView {
  const key = analysisStateCacheKey(state);
  const cached = analysisGraphViewCache.get(key);
  if (cached?.state === state) {
    analysisGraphViewCache.delete(key);
    analysisGraphViewCache.set(key, cached);
    return cached.view;
  }
  const view = buildAnalysisStateGraphView(state);
  cacheAnalysisStateGraphView(state, view);
  return view;
}

function buildAnalysisStateGraphView(state: AnalysisStateView): DependencyGraphView {
  const nodes = new Map(state.structuralNodes.map((node) => [node.id, node.attributes]));
  const dependents = new Map<string, string[]>();
  const dependencies = new Map<string, string[]>();
  const relationships = new Map<string, GraphEdgeAttributes>();
  for (const relationship of state.structuralRelationships) {
    append(dependents, relationship.targetId, relationship.sourceId);
    append(dependencies, relationship.sourceId, relationship.targetId);
    relationships.set(
      relationshipKey(relationship.sourceId, relationship.targetId),
      relationship.attributes,
    );
  }
  for (const values of dependents.values()) values.sort(compareStrings);
  for (const values of dependencies.values()) values.sort(compareStrings);
  const nodeIdsByKind = new Map<GraphNodeAttributes['kind'], string[]>();
  for (const [id, attributes] of nodes) append(nodeIdsByKind, attributes.kind, id);

  return Object.freeze({
    hasNode: (id: string) => nodes.has(id),
    getNodeAttributes: (id: string) => nodes.get(id),
    getNodesByKind: (kind: GraphNodeAttributes['kind']) => [...(nodeIdsByKind.get(kind) ?? [])],
    getDependents: (id: string) => dependents.get(id) ?? [],
    getDependencies: (id: string) => dependencies.get(id) ?? [],
    getEdgeAttributes: (sourceId: string, targetId: string) =>
      relationships.get(relationshipKey(sourceId, targetId)),
  });
}

function cacheAnalysisStateGraphView(state: AnalysisStateView, view: DependencyGraphView): void {
  const key = analysisStateCacheKey(state);
  analysisGraphViewCache.delete(key);
  analysisGraphViewCache.set(key, { state, view });
  while (analysisGraphViewCache.size > ANALYSIS_GRAPH_VIEW_CACHE_LIMIT) {
    const oldestKey = analysisGraphViewCache.keys().next().value as string | undefined;
    if (oldestKey === undefined) break;
    analysisGraphViewCache.delete(oldestKey);
  }
}

function analysisStateCacheKey(state: AnalysisStateView): string {
  return `${state.repositoryId}\u0000${state.analysisVersion}`;
}

/** Stable serialization for hashing, persistence comparisons, and regression tests. */
export function serializeAnalysisStateView(state: AnalysisStateView): string {
  return JSON.stringify(canonicalValue(AnalysisStateViewSchema.parse(state)));
}

function canonicalNullableCollection<T>(
  values: readonly T[] | null | undefined,
  identity: (value: T) => string,
): T[] | null {
  return values === undefined || values === null ? null : canonicalCollection(values, identity);
}

function canonicalCollection<T>(values: readonly T[], identity: (value: T) => string): T[] {
  return values
    .map((value) => canonicalValue(value))
    .sort((left, right) => compareStrings(identity(left), identity(right)));
}

function canonicalValue<T>(value: T): T {
  if (Array.isArray(value)) {
    const canonicalItems = value.map((item) => canonicalValue(item));
    canonicalItems.sort((left, right) =>
      compareStrings(JSON.stringify(left), JSON.stringify(right)),
    );
    return canonicalItems as T;
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort(compareStrings)
        .map((key) => [key, canonicalValue(value[key])]),
    ) as T;
  }
  return value;
}

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
  } else if (isRecord(value)) {
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return Object.freeze(value);
}

function relationshipIdentity(relationship: AnalysisStateRelationship): string {
  return `${relationship.sourceId}\u0000${relationship.targetId}\u0000${JSON.stringify(
    relationship.attributes,
  )}`;
}

function relationshipKey(sourceId: string, targetId: string): string {
  return `${sourceId}\u0000${targetId}`;
}

function append<K>(map: Map<K, string[]>, key: K, value: string): void {
  const values = map.get(key) ?? [];
  values.push(value);
  map.set(key, values);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export type { GraphEdgeAttributes, GraphNodeAttributes };
