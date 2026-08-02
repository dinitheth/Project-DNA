/**
 * EntitySynthesizer — Converts raw analysis entities into enriched DNAObjects.
 *
 * Takes FileDNA, ClassDNA, FunctionDNA and enriches them with:
 * - Architecture role inference (controller, service, repository, etc.)
 * - Purpose heuristics from naming and structure
 * - Initial importance scoring from dependency graph position
 * - Criticality classification
 */

import type { Logger } from '@project-dna/shared';
import type {
  FileDNA,
  RepositoryGraph,
  ArchitectureDNA,
  KnowledgeNode,
  RiskNode,
  DNAObject,
  ArchitectureRole,
  CriticalityLevel,
} from '@project-dna/dna-core';

export class EntitySynthesizer {
  constructor(private readonly logger: Logger) {}

  /**
   * Synthesize FileDNA array into enriched DNAObjects.
   */
  synthesize(
    files: FileDNA[],
    graph: RepositoryGraph,
    architecture: ArchitectureDNA,
    knowledgeNodes: KnowledgeNode[],
    risks: RiskNode[],
  ): DNAObject[] {
    this.logger.info(`Synthesizing ${files.length} files into DNAObjects`);
    const knowledgeIndex = this.indexKnowledgeNodes(knowledgeNodes);
    const riskIndex = this.indexRisks(risks);

    return files.map((file) => this.synthesizeFile(file, graph, architecture, knowledgeIndex, riskIndex));
  }

  private synthesizeFile(
    file: FileDNA,
    graph: RepositoryGraph,
    architecture: ArchitectureDNA,
    knowledgeIndex: Map<string, string[]>,
    riskIndex: Map<string, string[]>,
  ): DNAObject {
    const role = this.inferArchitectureRole(file, architecture);
    const purpose = this.inferPurpose(file, role);
    const layer = this.inferLayer(file, architecture);
    const importance = this.computeImportance(file.path, graph);
    const criticality = this.classifyCriticality(importance);
    const complexity = file.complexity;
    const healthScore = this.computeHealthScore(complexity, importance);
    const knowledgeNodeIds = knowledgeIndex.get(file.path) ?? [];
    const riskIds = riskIndex.get(file.path) ?? [];

    // Build dependency relationships from graph
    const dependsOn: string[] = [];
    const dependedOnBy: string[] = [];
    if (graph.hasNode(file.path)) {
      graph.forEachOutEdge(file.path, (_edgeId, _attrs, _source, target) => {
        dependsOn.push(target);
      });
      graph.forEachInEdge(file.path, (_edgeId, _attrs, source) => {
        dependedOnBy.push(source);
      });
    }

    return {
      id: `file:${file.path}`,
      kind: 'file',
      name: this.extractFileName(file.path),
      path: file.path,
      purpose,
      architectureRole: role,
      businessDomain: null, // Set by DomainSynthesizer
      importance,
      criticality,
      complexity,
      healthScore,
      risks: riskIds,
      dependsOn,
      dependedOnBy,
      belongsToDomain: null, // Set by DomainSynthesizer
      belongsToLayer: layer,
      knowledgeNodeIds,
      knowledgeDensity: knowledgeNodeIds.length > 0 ? Math.min(1, knowledgeNodeIds.length / 5) : 0,
      confidence: 0.7, // Base confidence for heuristic analysis
      lastAnalyzedAt: Date.now(),
    };
  }

  private inferArchitectureRole(file: FileDNA, _architecture: ArchitectureDNA): ArchitectureRole {
    const pathLower = file.path.toLowerCase();
    const name = this.extractFileName(file.path).toLowerCase();

    // Test files
    if (name.includes('.test.') || name.includes('.spec.') || pathLower.includes('__tests__')) {
      return 'test';
    }

    // Entry points
    if (name === 'index.ts' || name === 'index.js' || name === 'main.ts' || name === 'main.js') {
      if (file.exports.length > 3 && file.imports.length > 3) return 'barrel';
      return 'entry-point';
    }

    // Type definitions
    if (name.endsWith('.d.ts') || name.includes('.types.') || name.includes('.interface.')) {
      return 'type-definition';
    }

    // Config files
    if (name.includes('config') || name.includes('.rc.')) {
      return 'config';
    }

    // By path patterns
    if (pathLower.includes('/controllers/') || pathLower.includes('/controller/')) return 'controller';
    if (pathLower.includes('/services/') || pathLower.includes('/service/')) return 'service';
    if (pathLower.includes('/repositories/') || pathLower.includes('/repository/') || pathLower.includes('/repo/')) return 'repository';
    if (pathLower.includes('/models/') || pathLower.includes('/model/') || pathLower.includes('/entities/')) return 'model';
    if (pathLower.includes('/views/') || pathLower.includes('/components/') || pathLower.includes('/pages/')) return 'view';
    if (pathLower.includes('/middleware/') || pathLower.includes('/middlewares/')) return 'middleware';
    if (pathLower.includes('/utils/') || pathLower.includes('/helpers/') || pathLower.includes('/lib/')) return 'utility';

    // By naming patterns
    if (name.includes('controller')) return 'controller';
    if (name.includes('service')) return 'service';
    if (name.includes('repository') || name.includes('repo')) return 'repository';
    if (name.includes('model') || name.includes('entity') || name.includes('schema')) return 'model';
    if (name.includes('middleware')) return 'middleware';
    if (name.includes('util') || name.includes('helper')) return 'utility';

    return 'unknown';
  }

  private inferPurpose(file: FileDNA, role: ArchitectureRole): string {
    const name = this.extractFileName(file.path).replace(/\.[^.]+$/, '');

    const roleDescriptions: Record<ArchitectureRole, string> = {
      controller: `Handles incoming requests for ${name}`,
      service: `Business logic for ${name}`,
      repository: `Data access for ${name}`,
      model: `Data model definition for ${name}`,
      view: `UI component for ${name}`,
      middleware: `Request middleware for ${name}`,
      utility: `Utility functions for ${name}`,
      config: `Configuration for ${name}`,
      test: `Test suite for ${name}`,
      'type-definition': `Type definitions for ${name}`,
      'entry-point': `Module entry point for ${name}`,
      barrel: `Barrel re-export for ${name}`,
      unknown: `Module ${name}`,
    };

    return roleDescriptions[role];
  }

  private inferLayer(file: FileDNA, architecture: ArchitectureDNA): string | null {
    const pathLower = file.path.toLowerCase();
    for (const layer of architecture.layers) {
      if (pathLower.includes(`/${layer.name.toLowerCase()}/`)) {
        return layer.name;
      }
    }
    return null;
  }

  private computeImportance(filePath: string, graph: RepositoryGraph): number {
    if (!graph.hasNode(filePath)) return 0.1;
    const inDeg = graph.inDegree(filePath);
    const outDeg = graph.outDegree(filePath);
    const totalNodes = graph.nodeCount;
    if (totalNodes <= 1) return 0.5;

    const normalizedFanIn = Math.min(1, inDeg / Math.max(1, totalNodes * 0.1));
    const normalizedFanOut = Math.min(1, outDeg / Math.max(1, totalNodes * 0.1));
    return Math.min(1, normalizedFanIn * 0.7 + normalizedFanOut * 0.3);
  }

  private classifyCriticality(importance: number): CriticalityLevel {
    if (importance >= 0.8) return 'critical';
    if (importance >= 0.6) return 'high';
    if (importance >= 0.3) return 'medium';
    return 'low';
  }

  private computeHealthScore(complexity: number, importance: number): number {
    const complexityPenalty = Math.min(1, complexity / 50);
    return Math.max(0, Math.min(1, 1 - complexityPenalty * (0.5 + importance * 0.5)));
  }

  private extractFileName(filePath: string): string {
    return filePath.split(/[/\\]/).pop() ?? filePath;
  }

  private indexKnowledgeNodes(nodes: KnowledgeNode[]): Map<string, string[]> {
    const index = new Map<string, string[]>();
    for (const node of nodes) {
      // KnowledgeNode uses sourceRef for the associated entity
      if (node.sourceRef) {
        const existing = index.get(node.sourceRef) ?? [];
        existing.push(node.id);
        index.set(node.sourceRef, existing);
      }
    }
    return index;
  }

  private indexRisks(risks: RiskNode[]): Map<string, string[]> {
    const index = new Map<string, string[]>();
    for (const risk of risks) {
      // RiskNode uses affectedEntities for affected file paths
      for (const entityRef of risk.affectedEntities) {
        const existing = index.get(entityRef) ?? [];
        existing.push(risk.id);
        index.set(entityRef, existing);
      }
    }
    return index;
  }
}
