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
import { RiskNodeSchema, type RiskNode } from './risk-node.js';

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
  return deepFreeze(canonicalValue(parsed));
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

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export type { GraphEdgeAttributes, GraphNodeAttributes };
