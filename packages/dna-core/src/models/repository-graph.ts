/**
 * RepositoryGraph — Typed wrapper around a Graphology DirectedGraph.
 *
 * Design decisions:
 * - Wraps Graphology rather than extending it to maintain a clean API surface.
 * - The underlying Graphology instance is NEVER exposed — all access is through
 *   typed methods to prevent abstraction leakage.
 * - DNA-specific node and edge attribute types enforce consistency.
 * - Provides convenience methods for adding files, dependencies, and modules.
 * - Serializable to/from JSON for storage persistence.
 */

import { DirectedGraph } from 'graphology';
import type { Attributes, SerializedGraph } from 'graphology-types';

// ─── Graph Node/Edge Attribute Types ────────────────────────────────

export interface GraphNodeAttributes extends Attributes {
  /** What kind of node this is. */
  kind: 'file' | 'module' | 'package' | 'external';
  /** Display label. */
  label: string;
  /** Relative path (for file/module nodes). */
  path?: string;
  /** Language (for file nodes). */
  language?: string;
  /** Aggregate complexity (for file nodes). */
  complexity?: number;
  /** Lines of code (for file nodes). */
  linesOfCode?: number;
}

export interface GraphEdgeAttributes extends Attributes {
  /** Type of dependency. */
  type: 'import' | 're-export' | 'dynamic-import' | 'require' | 'type-import';
  /** Whether this is a type-only import. */
  isTypeOnly: boolean;
  /** Number of symbols imported along this edge. */
  specifierCount: number;
  /** Whether the target is external (node_modules). */
  isExternal: boolean;
}

// ─── RepositoryGraph Class ──────────────────────────────────────────

export class RepositoryGraph {
  private readonly graph: DirectedGraph<GraphNodeAttributes, GraphEdgeAttributes>;

  constructor() {
    this.graph = new DirectedGraph<GraphNodeAttributes, GraphEdgeAttributes>();
  }

  // ─── Properties ─────────────────────────────────────────────────

  /** Number of nodes in the graph. */
  get nodeCount(): number {
    return this.graph.order;
  }

  /** Number of edges in the graph. */
  get edgeCount(): number {
    return this.graph.size;
  }

  // ─── Node Mutations ─────────────────────────────────────────────

  /**
   * Add a file node to the graph.
   */
  addFileNode(id: string, attributes: Omit<GraphNodeAttributes, 'kind'>): void {
    if (!this.graph.hasNode(id)) {
      this.graph.addNode(id, { ...attributes, kind: 'file' } as GraphNodeAttributes);
    }
  }

  /**
   * Add a module node to the graph.
   */
  addModuleNode(id: string, attributes: Omit<GraphNodeAttributes, 'kind'>): void {
    if (!this.graph.hasNode(id)) {
      this.graph.addNode(id, { ...attributes, kind: 'module' } as GraphNodeAttributes);
    }
  }

  /**
   * Add an external dependency node.
   */
  addExternalNode(id: string, label: string): void {
    if (!this.graph.hasNode(id)) {
      this.graph.addNode(id, { kind: 'external', label });
    }
  }

  /**
   * Add a dependency edge between two nodes.
   */
  addDependency(sourceId: string, targetId: string, attributes: GraphEdgeAttributes): void {
    if (this.graph.hasNode(sourceId) && this.graph.hasNode(targetId)) {
      if (this.graph.hasEdge(sourceId, targetId)) {
        const edgeId = this.graph.edge(sourceId, targetId);
        if (!edgeId) return;
        const existing = this.graph.getEdgeAttributes(edgeId);
        this.graph.replaceEdgeAttributes(edgeId, {
          type: selectDependencyType(existing.type, attributes.type),
          isTypeOnly: existing.isTypeOnly && attributes.isTypeOnly,
          specifierCount: existing.specifierCount + attributes.specifierCount,
          isExternal: existing.isExternal && attributes.isExternal,
        });
      } else {
        this.graph.addEdge(sourceId, targetId, attributes);
      }
    }
  }

  // ─── Node Queries ───────────────────────────────────────────────

  /**
   * Check if a node exists.
   */
  hasNode(id: string): boolean {
    return this.graph.hasNode(id);
  }

  /**
   * Get all node IDs.
   */
  getNodeIds(): string[] {
    return this.graph.nodes();
  }

  /**
   * Get attributes for a node.
   */
  getNodeAttributes(id: string): GraphNodeAttributes | undefined {
    if (!this.graph.hasNode(id)) return undefined;
    return this.graph.getNodeAttributes(id);
  }

  /**
   * Get all direct dependencies (outgoing edges) of a node.
   */
  getDependencies(nodeId: string): string[] {
    if (!this.graph.hasNode(nodeId)) return [];
    return this.graph.outNeighbors(nodeId);
  }

  /**
   * Get all dependents (incoming edges) of a node.
   */
  getDependents(nodeId: string): string[] {
    if (!this.graph.hasNode(nodeId)) return [];
    return this.graph.inNeighbors(nodeId);
  }

  // ─── Typed Traversal Methods ────────────────────────────────────

  /**
   * Iterate over all nodes with typed attributes.
   */
  forEachNode(callback: (id: string, attributes: GraphNodeAttributes) => void): void {
    this.graph.forEachNode((id, attrs) => callback(id, attrs));
  }

  /**
   * Iterate over all edges with typed attributes.
   */
  forEachEdge(
    callback: (
      edgeId: string,
      attributes: GraphEdgeAttributes,
      sourceId: string,
      targetId: string,
    ) => void,
  ): void {
    this.graph.forEachEdge((edge, attrs, source, target) => callback(edge, attrs, source, target));
  }

  /**
   * Iterate over outgoing edges of a specific node.
   */
  forEachOutEdge(
    nodeId: string,
    callback: (
      edgeId: string,
      attributes: GraphEdgeAttributes,
      sourceId: string,
      targetId: string,
    ) => void,
  ): void {
    if (!this.graph.hasNode(nodeId)) return;
    this.graph.forEachOutEdge(nodeId, (edge, attrs, source, target) =>
      callback(edge, attrs, source, target),
    );
  }

  /**
   * Iterate over incoming edges of a specific node.
   */
  forEachInEdge(
    nodeId: string,
    callback: (
      edgeId: string,
      attributes: GraphEdgeAttributes,
      sourceId: string,
      targetId: string,
    ) => void,
  ): void {
    if (!this.graph.hasNode(nodeId)) return;
    this.graph.forEachInEdge(nodeId, (edge, attrs, source, target) =>
      callback(edge, attrs, source, target),
    );
  }

  /**
   * Get edge attributes between two specific nodes.
   */
  getEdgeAttributes(sourceId: string, targetId: string): GraphEdgeAttributes | undefined {
    if (!this.graph.hasEdge(sourceId, targetId)) return undefined;
    return this.graph.getEdgeAttributes(this.graph.edge(sourceId, targetId)!);
  }

  /**
   * Check if an edge exists between two nodes.
   */
  hasEdge(sourceId: string, targetId: string): boolean {
    return this.graph.hasEdge(sourceId, targetId);
  }

  // ─── Degree Metrics ─────────────────────────────────────────────

  /** Number of outgoing edges (fan-out) for a node. */
  outDegree(nodeId: string): number {
    if (!this.graph.hasNode(nodeId)) return 0;
    return this.graph.outDegree(nodeId);
  }

  /** Number of incoming edges (fan-in) for a node. */
  inDegree(nodeId: string): number {
    if (!this.graph.hasNode(nodeId)) return 0;
    return this.graph.inDegree(nodeId);
  }

  /** Total degree (fan-in + fan-out) for a node. */
  degree(nodeId: string): number {
    if (!this.graph.hasNode(nodeId)) return 0;
    return this.graph.degree(nodeId);
  }

  // ─── Filtered Queries ───────────────────────────────────────────

  /**
   * Get all nodes of a specific kind.
   */
  getNodesByKind(kind: GraphNodeAttributes['kind']): string[] {
    const result: string[] = [];
    this.graph.forEachNode((id, attrs) => {
      if (attrs.kind === kind) result.push(id);
    });
    return result;
  }

  /**
   * Get all edges of a specific type.
   */
  getEdgesByType(
    type: GraphEdgeAttributes['type'],
  ): Array<{ source: string; target: string; attributes: GraphEdgeAttributes }> {
    const result: Array<{ source: string; target: string; attributes: GraphEdgeAttributes }> = [];
    this.graph.forEachEdge((_edge, attrs, source, target) => {
      if (attrs.type === type) result.push({ source, target, attributes: attrs });
    });
    return result;
  }

  // ─── Serialization ──────────────────────────────────────────────

  /**
   * Serialize the graph to a JSON-compatible object.
   */
  toJSON(): object {
    return this.graph.export();
  }

  /**
   * Deserialize a graph from a JSON-compatible object.
   */
  static fromJSON(data: Record<string, unknown>): RepositoryGraph {
    const repoGraph = new RepositoryGraph();
    repoGraph.graph.import(
      data as Partial<SerializedGraph<GraphNodeAttributes, GraphEdgeAttributes>>,
    );
    return repoGraph;
  }
}

const DEPENDENCY_TYPE_PRIORITY: Record<GraphEdgeAttributes['type'], number> = {
  'dynamic-import': 1,
  'type-import': 2,
  're-export': 3,
  require: 4,
  import: 5,
};

function selectDependencyType(
  left: GraphEdgeAttributes['type'],
  right: GraphEdgeAttributes['type'],
): GraphEdgeAttributes['type'] {
  return DEPENDENCY_TYPE_PRIORITY[left] >= DEPENDENCY_TYPE_PRIORITY[right] ? left : right;
}
