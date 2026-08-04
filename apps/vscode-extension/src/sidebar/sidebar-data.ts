import { isErr } from '@project-dna/shared';
import type {
  ArchitectureData,
  DependencyData,
  KnowledgeData,
  RepositoryData,
} from '@project-dna/shared';
import type { IProjectDNAService, ProjectDNA, RepositoryGraph } from '@project-dna/dna-core';

/** Builds the complete, presentation-ready sidebar payload from the public service API. */
export async function buildSidebarData(service: IProjectDNAService): Promise<{
  readonly repository: RepositoryData;
  readonly architecture: ArchitectureData;
  readonly dependencies: DependencyData;
  readonly knowledge: KnowledgeData;
}> {
  const current = service.getCurrent();
  if (isErr(current)) throw current.error;
  if (!current.value) throw new Error('No Project DNA analysis is currently available');

  const [domains, capabilities, knowledge, dependencyGraph] = await Promise.all([
    service.getDomains(),
    service.getCapabilities(),
    service.getKnowledge(50),
    service.getDependencyGraph(),
  ]);

  if (isErr(domains)) throw domains.error;
  if (isErr(capabilities)) throw capabilities.error;
  if (isErr(knowledge)) throw knowledge.error;
  if (isErr(dependencyGraph)) throw dependencyGraph.error;

  const dna = current.value;
  const latest = service.getCurrent();
  if (isErr(latest)) throw latest.error;
  if (!latest.value || latest.value.id !== dna.id || latest.value.version !== dna.version) {
    throw new Error('Project DNA changed while sidebar data was being assembled');
  }

  return {
    repository: toRepositoryData(dna),
    architecture: {
      pattern: dna.architecture.pattern,
      confidence: dna.architecture.confidence,
      detectedAt: dna.architecture.detectedAt,
      detectedPatterns: dna.architecture.detectedPatterns.map((item) => ({ ...item })),
      layers: dna.architecture.layers.map((layer) => ({
        name: layer.name,
        role: layer.role,
        fileCount: layer.fileCount,
        directories: [...layer.directories],
      })),
      evidence: dna.architecture.evidence.map((item) => ({
        rule: item.rule,
        description: item.description,
        matchedPaths: [...item.matchedPaths],
        weight: item.weight,
      })),
      summary: dna.story.architectureSummary,
    },
    dependencies: toDependencyData(dependencyGraph.value),
    knowledge: {
      domains: domains.value.map((domain) => ({
        name: domain.name,
        confidence: domain.confidence,
        fileCount: domain.fileCount,
        linesOfCode: domain.linesOfCode,
        primaryLanguages: [...domain.primaryLanguages],
        rootPaths: [...domain.rootPaths],
      })),
      capabilities: capabilities.value.map((capability) => ({
        name: capability.name,
        category: capability.category,
        description: capability.description,
        confidence: capability.confidence,
        implementationCount: capability.implementedBy.length,
      })),
      nodes: knowledge.value.map((node) => ({
        name: node.name,
        type: node.type,
        sourceRef: node.sourceRef ?? null,
        tags: [...node.tags],
        relationshipCount: node.relationships.length,
      })),
    },
  };
}

function toRepositoryData(dna: ProjectDNA): RepositoryData {
  const coverage = { scanned: 0, parsed: 0, skipped: 0, failed: 0, ...dna.analysisCoverage };
  return {
    name: dna.profile.name,
    description: dna.profile.description,
    rootPath: dna.rootPath,
    version: dna.version,
    analyzedAt: dna.analyzedAt,
    durationMs: dna.durationMs,
    projectType: dna.profile.projectType,
    repositorySize: dna.profile.repositorySize,
    packageManager: dna.profile.packageManager,
    testFramework: dna.profile.testFramework,
    ciSystem: dna.profile.ciSystem,
    languages: dna.profile.primaryLanguages.map((language) => ({ ...language })),
    frameworks: dna.profile.frameworks.map((framework) => ({ ...framework })),
    counts: {
      modules: dna.moduleCount,
      entities: dna.entityCount,
      domains: dna.domainCount,
      capabilities: dna.capabilityCount,
      knowledgeNodes: dna.knowledgeNodeCount,
      risks: dna.riskCount,
    },
    coverage,
    health: {
      overallScore: dna.health.overallScore,
      trend: dna.health.trend,
      dimensions: { ...dna.health.dimensions },
    },
    complexity: {
      averageComplexity: dna.complexity.averageComplexity,
      maxComplexity: dna.complexity.maxComplexity,
      mostComplexFile: dna.complexity.mostComplexFile,
      complexCodePercentage: dna.complexity.complexCodePercentage,
      averageNestingDepth: dna.complexity.averageNestingDepth,
      maxNestingDepth: dna.complexity.maxNestingDepth,
    },
    risks: {
      overallRiskScore: dna.risks.overallRiskScore,
      totalRisks: dna.risks.totalRisks,
      bySeverity: { ...dna.risks.bySeverity },
      topRisks: dna.risks.topRisks.map((risk) => ({
        type: risk.type,
        severity: risk.severity,
        description: risk.description,
        affectedEntityCount: risk.affectedEntityCount,
      })),
    },
    criticalComponents: dna.criticalComponents.map((component) => ({
      name: component.name,
      path: component.path,
      criticality: component.criticality,
      score: component.score,
      reason: component.reason,
    })),
    story: {
      summary: dna.story.summary,
      healthSummary: dna.story.healthSummary,
      criticalPath: dna.story.criticalPath,
      risks: [...dna.story.risks],
    },
  };
}

function toDependencyData(graph: RepositoryGraph): DependencyData {
  const hotspots = graph
    .getNodeIds()
    .map((id) => {
      const attributes = graph.getNodeAttributes(id);
      return {
        id,
        label: attributes?.label ?? id,
        path: attributes?.path ?? null,
        kind: attributes?.kind ?? 'unknown',
        dependencies: graph.outDegree(id),
        dependents: graph.inDegree(id),
        totalConnections: graph.degree(id),
      };
    })
    .sort(
      (left, right) =>
        right.totalConnections - left.totalConnections || left.label.localeCompare(right.label),
    )
    .slice(0, 12);

  return {
    nodeCount: graph.nodeCount,
    edgeCount: graph.edgeCount,
    nodeKinds: {
      files: graph.getNodesByKind('file').length,
      modules: graph.getNodesByKind('module').length,
      packages: graph.getNodesByKind('package').length,
      external: graph.getNodesByKind('external').length,
    },
    edgeTypes: {
      imports: graph.getEdgesByType('import').length,
      reExports: graph.getEdgesByType('re-export').length,
      dynamicImports: graph.getEdgesByType('dynamic-import').length,
      requires: graph.getEdgesByType('require').length,
      typeImports: graph.getEdgesByType('type-import').length,
    },
    hotspots,
  };
}
