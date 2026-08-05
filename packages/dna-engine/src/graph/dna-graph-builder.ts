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
import { createSemanticDnaGraph, type DNAGraph } from '@project-dna/dna-core';
import type { DNAObject, BusinessDomain, Capability, ArchitectureDNA } from '@project-dna/dna-core';

export class DNAGraphBuilder {
  constructor(private readonly logger: Logger) {}

  build(
    entities: DNAObject[],
    domains: BusinessDomain[],
    capabilities: Capability[],
    architecture: ArchitectureDNA,
  ): DNAGraph {
    this.logger.info('Building semantic DNA graph...');
    const graph = createSemanticDnaGraph({ entities, domains, capabilities, architecture });

    this.logger.info(`DNA graph built: ${graph.nodeCount} nodes, ${graph.edgeCount} edges`);
    return graph;
  }
}
