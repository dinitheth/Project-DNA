/**
 * DNAGraphBuilder — Constructs the semantic DNAGraph from all analysis outputs.
 *
 * The DNAGraph is distinct from the DependencyGraph:
 * - DependencyGraph = structural (file A imports file B)
 * - DNAGraph = semantic (module A serves domain X, capability Y depends on domain Z)
 *
 * Builds nodes for domains, capabilities, layers, and entities,
 * then connects them with typed semantic edges.
 */

import type { Logger } from '@project-dna/shared';
import { DNAGraph } from '@project-dna/dna-core';
import type {
  DNAObject,
  BusinessDomain,
  Capability,
  ArchitectureDNA,
  DNAGraphNodeAttributes,
  DNAGraphEdgeAttributes,
} from '@project-dna/dna-core';

export class DNAGraphBuilder {
  constructor(private readonly logger: Logger) {}

  build(
    entities: DNAObject[],
    domains: BusinessDomain[],
    capabilities: Capability[],
    architecture: ArchitectureDNA,
  ): DNAGraph {
    this.logger.info('Building semantic DNA graph...');
    const graph = new DNAGraph();

    this.addDomainNodes(graph, domains);
    this.addLayerNodes(graph, architecture);
    this.addCapabilityNodes(graph, capabilities);
    this.addEntityNodes(graph, entities);
    this.addDomainContainmentEdges(graph, domains);
    this.addLayerMembershipEdges(graph, entities);
    this.addCapabilityEdges(graph, capabilities);
    this.addEntityDependencyEdges(graph, entities);

    this.logger.info(`DNA graph built: ${graph.nodeCount} nodes, ${graph.edgeCount} edges`);
    return graph;
  }

  private addDomainNodes(graph: DNAGraph, domains: BusinessDomain[]): void {
    for (const domain of domains) {
      const attrs: DNAGraphNodeAttributes = {
        kind: 'domain',
        label: domain.name,
        weight:
          domain.fileCount /
          Math.max(
            1,
            domains.reduce((s, d) => s + d.fileCount, 0),
          ),
        metadata: {
          fileCount: domain.fileCount,
          confidence: domain.confidence,
        },
      };
      graph.addNode(domain.id, attrs);
    }
  }

  private addLayerNodes(graph: DNAGraph, architecture: ArchitectureDNA): void {
    for (const layer of architecture.layers) {
      const attrs: DNAGraphNodeAttributes = {
        kind: 'layer',
        label: layer.name,
        weight: 0.5,
        metadata: {
          layerRole: layer.role,
        },
      };
      graph.addNode(`layer:${layer.name}`, attrs);
    }
  }

  private addCapabilityNodes(graph: DNAGraph, capabilities: Capability[]): void {
    for (const cap of capabilities) {
      const attrs: DNAGraphNodeAttributes = {
        kind: 'capability',
        label: cap.name,
        weight: cap.confidence,
        metadata: {
          category: cap.category,
          description: cap.description,
        },
      };
      graph.addNode(cap.id, attrs);
    }
  }

  private addEntityNodes(graph: DNAGraph, entities: DNAObject[]): void {
    for (const entity of entities) {
      const attrs: DNAGraphNodeAttributes = {
        kind: 'entity',
        label: entity.name,
        weight: entity.importance,
        metadata: {
          role: entity.architectureRole,
          criticality: entity.criticality,
          healthScore: entity.healthScore,
        },
      };
      graph.addNode(entity.id, attrs);
    }
  }

  private addDomainContainmentEdges(graph: DNAGraph, domains: BusinessDomain[]): void {
    for (const domain of domains) {
      for (const entityId of domain.entityIds) {
        if (graph.hasNode(entityId)) {
          const attrs: DNAGraphEdgeAttributes = {
            kind: 'belongs-to',
            weight: 1.0,
            confidence: domain.confidence,
          };
          graph.addEdge(entityId, domain.id, attrs);
        }
      }
    }
  }

  private addLayerMembershipEdges(graph: DNAGraph, entities: DNAObject[]): void {
    for (const entity of entities) {
      if (entity.belongsToLayer) {
        const layerNodeId = `layer:${entity.belongsToLayer}`;
        if (graph.hasNode(layerNodeId)) {
          const attrs: DNAGraphEdgeAttributes = {
            kind: 'belongs-to',
            weight: 1.0,
            confidence: 0.8,
          };
          graph.addEdge(entity.id, layerNodeId, attrs);
        }
      }
    }
  }

  private addCapabilityEdges(graph: DNAGraph, capabilities: Capability[]): void {
    for (const cap of capabilities) {
      for (const entityId of cap.implementedBy) {
        if (graph.hasNode(entityId)) {
          const attrs: DNAGraphEdgeAttributes = {
            kind: 'serves',
            weight: cap.confidence,
            confidence: cap.confidence,
          };
          graph.addEdge(entityId, cap.id, attrs);
        }
      }
    }
  }

  private addEntityDependencyEdges(graph: DNAGraph, entities: DNAObject[]): void {
    for (const entity of entities) {
      for (const depId of entity.dependsOn) {
        if (graph.hasNode(depId)) {
          const attrs: DNAGraphEdgeAttributes = {
            kind: 'depends-on',
            weight: 0.5,
            confidence: 0.9,
          };
          graph.addEdge(entity.id, depId, attrs);
        }
      }
    }
  }
}
