/**
 * DNAGraph — Semantic knowledge graph (distinct from DependencyGraph).
 *
 * The DependencyGraph models STRUCTURAL relationships (file A imports file B).
 * The DNAGraph models SEMANTIC relationships (module A serves domain X,
 * which depends on capability Y).
 *
 * Uses the same Graphology wrapper pattern as RepositoryGraph,
 * with the underlying instance NEVER exposed.
 */

import { DirectedGraph } from 'graphology';
import type { Attributes, SerializedGraph } from 'graphology-types';
import type { ArchitectureDNA } from './architecture-dna.js';
import type { BusinessDomain } from './business-domain.js';
import type { Capability } from './capability.js';
import type { DNAObject } from './dna-object.js';

// ─── Node Types ─────────────────────────────────────────────────────

export type DNAGraphNodeKind =
  'module' | 'domain' | 'layer' | 'concept' | 'capability' | 'component' | 'risk' | 'entity';

export interface DNAGraphNodeAttributes extends Attributes {
  /** What kind of semantic node this is. */
  kind: DNAGraphNodeKind;
  /** Display label. */
  label: string;
  /** Centrality / importance weight. */
  weight: number;
  /** Kind-specific metadata. */
  metadata: Record<string, unknown>;
}

// ─── Edge Types ─────────────────────────────────────────────────────

export type DNAGraphEdgeKind =
  | 'contains'
  | 'serves'
  | 'depends-on'
  | 'implements'
  | 'risks'
  | 'constrains'
  | 'belongs-to'
  | 'evolves-from';

export interface DNAGraphEdgeAttributes extends Attributes {
  /** Semantic relationship type. */
  kind: DNAGraphEdgeKind;
  /** Strength of the relationship (0-1). */
  weight: number;
  /** How certain is this edge? (0-1). */
  confidence: number;
}

// ─── DNAGraph Class ─────────────────────────────────────────────────

export class DNAGraph {
  private readonly graph: DirectedGraph<DNAGraphNodeAttributes, DNAGraphEdgeAttributes>;

  constructor() {
    this.graph = new DirectedGraph<DNAGraphNodeAttributes, DNAGraphEdgeAttributes>();
  }

  // ─── Properties ─────────────────────────────────────────────────

  get nodeCount(): number {
    return this.graph.order;
  }

  get edgeCount(): number {
    return this.graph.size;
  }

  // ─── Node Operations ────────────────────────────────────────────

  addNode(id: string, attributes: DNAGraphNodeAttributes): void {
    if (!this.graph.hasNode(id)) {
      this.graph.addNode(id, attributes);
    }
  }

  hasNode(id: string): boolean {
    return this.graph.hasNode(id);
  }

  getNodeAttributes(id: string): DNAGraphNodeAttributes | undefined {
    if (!this.graph.hasNode(id)) return undefined;
    return this.graph.getNodeAttributes(id);
  }

  getNodeIds(): string[] {
    return this.graph.nodes();
  }

  // ─── Edge Operations ────────────────────────────────────────────

  addEdge(sourceId: string, targetId: string, attributes: DNAGraphEdgeAttributes): void {
    if (this.graph.hasNode(sourceId) && this.graph.hasNode(targetId)) {
      if (!this.graph.hasEdge(sourceId, targetId)) {
        this.graph.addEdge(sourceId, targetId, attributes);
      }
    }
  }

  hasEdge(sourceId: string, targetId: string): boolean {
    return this.graph.hasEdge(sourceId, targetId);
  }

  getEdgeAttributes(sourceId: string, targetId: string): DNAGraphEdgeAttributes | undefined {
    if (!this.graph.hasEdge(sourceId, targetId)) return undefined;
    return this.graph.getEdgeAttributes(this.graph.edge(sourceId, targetId)!);
  }

  // ─── Traversal ──────────────────────────────────────────────────

  forEachNode(callback: (id: string, attributes: DNAGraphNodeAttributes) => void): void {
    this.graph.forEachNode((id, attrs) => callback(id, attrs));
  }

  forEachEdge(
    callback: (
      edgeId: string,
      attributes: DNAGraphEdgeAttributes,
      source: string,
      target: string,
    ) => void,
  ): void {
    this.graph.forEachEdge((edge, attrs, source, target) => callback(edge, attrs, source, target));
  }

  getNeighbors(nodeId: string): string[] {
    if (!this.graph.hasNode(nodeId)) return [];
    return this.graph.neighbors(nodeId);
  }

  getOutNeighbors(nodeId: string): string[] {
    if (!this.graph.hasNode(nodeId)) return [];
    return this.graph.outNeighbors(nodeId);
  }

  getInNeighbors(nodeId: string): string[] {
    if (!this.graph.hasNode(nodeId)) return [];
    return this.graph.inNeighbors(nodeId);
  }

  // ─── Filtered Queries ───────────────────────────────────────────

  getNodesByKind(kind: DNAGraphNodeKind): string[] {
    const result: string[] = [];
    this.graph.forEachNode((id, attrs) => {
      if (attrs.kind === kind) result.push(id);
    });
    return result;
  }

  getEdgesByKind(
    kind: DNAGraphEdgeKind,
  ): Array<{ source: string; target: string; attributes: DNAGraphEdgeAttributes }> {
    const result: Array<{ source: string; target: string; attributes: DNAGraphEdgeAttributes }> =
      [];
    this.graph.forEachEdge((_edge, attrs, source, target) => {
      if (attrs.kind === kind) result.push({ source, target, attributes: attrs });
    });
    return result;
  }

  // ─── Degree Metrics ─────────────────────────────────────────────

  inDegree(nodeId: string): number {
    if (!this.graph.hasNode(nodeId)) return 0;
    return this.graph.inDegree(nodeId);
  }

  outDegree(nodeId: string): number {
    if (!this.graph.hasNode(nodeId)) return 0;
    return this.graph.outDegree(nodeId);
  }

  // ─── Serialization ──────────────────────────────────────────────

  toJSON(): object {
    return this.graph.export();
  }

  static fromJSON(data: Record<string, unknown>): DNAGraph {
    const dnaGraph = new DNAGraph();
    dnaGraph.graph.import(
      data as Partial<SerializedGraph<DNAGraphNodeAttributes, DNAGraphEdgeAttributes>>,
    );
    return dnaGraph;
  }
}

/** Construct the deterministic semantic graph represented by persisted analysis collections. */
export function createSemanticDnaGraph(input: {
  readonly entities: readonly DNAObject[];
  readonly domains: readonly BusinessDomain[];
  readonly capabilities: readonly Capability[];
  readonly architecture: ArchitectureDNA;
}): DNAGraph {
  const graph = new DNAGraph();
  const domainFileCount = input.domains.reduce((total, domain) => total + domain.fileCount, 0);

  for (const domain of input.domains) {
    graph.addNode(domain.id, {
      kind: 'domain',
      label: domain.name,
      weight: domain.fileCount / Math.max(1, domainFileCount),
      metadata: { fileCount: domain.fileCount, confidence: domain.confidence },
    });
  }
  for (const layer of input.architecture.layers) {
    graph.addNode(`layer:${layer.name}`, {
      kind: 'layer',
      label: layer.name,
      weight: 0.5,
      metadata: { layerRole: layer.role },
    });
  }
  for (const capability of input.capabilities) {
    graph.addNode(capability.id, {
      kind: 'capability',
      label: capability.name,
      weight: capability.confidence,
      metadata: { category: capability.category, description: capability.description },
    });
  }
  for (const entity of input.entities) {
    graph.addNode(entity.id, {
      kind: 'entity',
      label: entity.name,
      weight: entity.importance,
      metadata: {
        role: entity.architectureRole,
        criticality: entity.criticality,
        healthScore: entity.healthScore,
      },
    });
  }

  for (const domain of input.domains) {
    for (const entityId of domain.entityIds) {
      graph.addEdge(entityId, domain.id, {
        kind: 'belongs-to',
        weight: 1,
        confidence: domain.confidence,
      });
    }
  }
  for (const entity of input.entities) {
    if (entity.belongsToLayer !== null) {
      graph.addEdge(entity.id, `layer:${entity.belongsToLayer}`, {
        kind: 'belongs-to',
        weight: 1,
        confidence: 0.8,
      });
    }
  }
  for (const capability of input.capabilities) {
    for (const entityId of capability.implementedBy) {
      graph.addEdge(entityId, capability.id, {
        kind: 'serves',
        weight: capability.confidence,
        confidence: capability.confidence,
      });
    }
  }
  for (const entity of input.entities) {
    for (const dependencyId of entity.dependsOn) {
      graph.addEdge(entity.id, dependencyId, {
        kind: 'depends-on',
        weight: 0.5,
        confidence: 0.9,
      });
    }
  }
  return graph;
}
