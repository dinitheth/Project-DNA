import { isErr } from '@project-dna/shared';
import type {
  ArchitectureData,
  DependencyData,
  EvolutionData,
  KnowledgeData,
  RepositoryData,
  SemanticGraphData,
} from '@project-dna/shared';
import type {
  CriticalComponent,
  DNAGraph,
  EvolutionSnapshot,
  IProjectDNAService,
  ProjectDNA,
  RepositoryGraph,
  RepositoryHealth,
  RepositoryProfile,
  RepositoryStory,
  RiskAssessment,
} from '@project-dna/dna-core';

const SEMANTIC_GRAPH_NODE_LIMIT = 100;
const SEMANTIC_GRAPH_EDGE_LIMIT = 200;
const EVOLUTION_HISTORY_LIMIT = 12;

/** Builds the complete, presentation-ready sidebar payload from the public service API. */
export async function buildSidebarData(service: IProjectDNAService): Promise<{
  readonly repository: RepositoryData;
  readonly architecture: ArchitectureData;
  readonly dependencies: DependencyData;
  readonly knowledge: KnowledgeData;
  readonly semanticGraph: SemanticGraphData;
  readonly evolution: EvolutionData;
}> {
  const current = service.getCurrent();
  if (isErr(current)) throw current.error;
  if (!current.value) throw new Error('No Project DNA analysis is currently available');

  const architecture = service.getArchitecture();
  const health = service.getHealth();
  const identity = service.getIdentity();
  const story = service.getStory();
  const risks = service.getRisks();
  const criticalComponents = service.getCriticalComponents();
  const [domains, capabilities, knowledge, dependencyGraph, dnaGraph, history, latestSnapshot] =
    await Promise.all([
      service.getDomains(),
      service.getCapabilities(),
      service.getKnowledge(50),
      service.getDependencyGraph(),
      service.getDNAGraph(),
      service.getHistory(EVOLUTION_HISTORY_LIMIT),
      service.getLatestSnapshot(),
    ]);

  if (isErr(domains)) throw domains.error;
  if (isErr(capabilities)) throw capabilities.error;
  if (isErr(knowledge)) throw knowledge.error;
  if (isErr(dependencyGraph)) throw dependencyGraph.error;
  if (isErr(dnaGraph)) throw dnaGraph.error;
  if (isErr(history)) throw history.error;
  if (isErr(latestSnapshot)) throw latestSnapshot.error;

  const dna = current.value;
  const latest = service.getCurrent();
  if (isErr(latest)) throw latest.error;
  if (!latest.value || latest.value.id !== dna.id || latest.value.version !== dna.version) {
    throw new Error('Project DNA changed while sidebar data was being assembled');
  }

  return {
    repository: toRepositoryData(dna, identity, health, risks, criticalComponents, story),
    architecture: {
      pattern: architecture.pattern,
      confidence: architecture.confidence,
      detectedAt: architecture.detectedAt,
      detectedPatterns: architecture.detectedPatterns.map((item) => ({ ...item })),
      layers: architecture.layers.map((layer) => ({
        name: layer.name,
        role: layer.role,
        fileCount: layer.fileCount,
        directories: [...layer.directories],
      })),
      evidence: architecture.evidence.map((item) => ({
        rule: item.rule,
        description: item.description,
        matchedPaths: [...item.matchedPaths],
        weight: item.weight,
      })),
      summary: story.architectureSummary,
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
    semanticGraph: toSemanticGraphData(dnaGraph.value),
    evolution: {
      latestSnapshot: latestSnapshot.value ? toEvolutionSnapshotData(latestSnapshot.value) : null,
      history: [...history.value]
        .sort((left, right) => right.version - left.version || right.timestamp - left.timestamp)
        .map(toEvolutionSnapshotData),
    },
  };
}

function toRepositoryData(
  dna: ProjectDNA,
  identity: RepositoryProfile,
  health: RepositoryHealth,
  risks: RiskAssessment,
  criticalComponents: CriticalComponent[],
  story: RepositoryStory,
): RepositoryData {
  const coverage = { scanned: 0, parsed: 0, skipped: 0, failed: 0, ...dna.analysisCoverage };
  return {
    name: identity.name,
    description: identity.description,
    rootPath: dna.rootPath,
    version: dna.version,
    analyzedAt: dna.analyzedAt,
    durationMs: dna.durationMs,
    projectType: identity.projectType,
    repositorySize: identity.repositorySize,
    packageManager: identity.packageManager,
    testFramework: identity.testFramework,
    ciSystem: identity.ciSystem,
    languages: identity.primaryLanguages.map((language) => ({ ...language })),
    frameworks: identity.frameworks.map((framework) => ({ ...framework })),
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
      overallScore: health.overallScore,
      trend: health.trend,
      dimensions: { ...health.dimensions },
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
      overallRiskScore: risks.overallRiskScore,
      totalRisks: risks.totalRisks,
      bySeverity: { ...risks.bySeverity },
      topRisks: risks.topRisks.map((risk) => ({
        type: risk.type,
        severity: risk.severity,
        description: risk.description,
        affectedEntityCount: risk.affectedEntityCount,
      })),
    },
    criticalComponents: criticalComponents.map((component) => ({
      name: component.name,
      path: component.path,
      criticality: component.criticality,
      score: component.score,
      reason: component.reason,
    })),
    story: {
      summary: story.summary,
      healthSummary: story.healthSummary,
      criticalPath: story.criticalPath,
      risks: [...story.risks],
    },
  };
}

function toSemanticGraphData(graph: DNAGraph): SemanticGraphData {
  const nodes = graph
    .getNodeIds()
    .map((id) => {
      const attributes = graph.getNodeAttributes(id);
      if (!attributes) throw new Error(`Semantic graph node is missing attributes: ${id}`);
      return {
        id,
        label: attributes.label,
        kind: attributes.kind,
        weight: attributes.weight,
        incomingRelationshipCount: graph.inDegree(id),
        outgoingRelationshipCount: graph.outDegree(id),
      };
    })
    .sort(
      (left, right) =>
        right.weight - left.weight ||
        left.label.localeCompare(right.label) ||
        left.id.localeCompare(right.id),
    )
    .slice(0, SEMANTIC_GRAPH_NODE_LIMIT);
  const includedNodeIds = new Set(nodes.map(({ id }) => id));
  const edges: SemanticGraphData['edges'] = [];
  graph.forEachEdge((_edgeId, attributes, source, target) => {
    if (!includedNodeIds.has(source) || !includedNodeIds.has(target)) return;
    edges.push({
      source,
      target,
      kind: attributes.kind,
      weight: attributes.weight,
      confidence: attributes.confidence,
    });
  });
  edges.sort(
    (left, right) =>
      left.source.localeCompare(right.source) ||
      left.target.localeCompare(right.target) ||
      left.kind.localeCompare(right.kind),
  );
  const boundedEdges = edges.slice(0, SEMANTIC_GRAPH_EDGE_LIMIT);
  return {
    nodeCount: graph.nodeCount,
    edgeCount: graph.edgeCount,
    nodes,
    edges: boundedEdges,
    truncated: graph.nodeCount > nodes.length || graph.edgeCount > boundedEdges.length,
  };
}

function toEvolutionSnapshotData(snapshot: EvolutionSnapshot): EvolutionData['history'][number] {
  return {
    id: snapshot.id,
    version: snapshot.version,
    timestamp: snapshot.timestamp,
    trigger: snapshot.trigger,
    projectDnaHash: snapshot.projectDnaHash,
    gitCommitHash: snapshot.gitCommitHash,
    metrics: { ...snapshot.metrics },
    isFullSnapshot: snapshot.isFullSnapshot,
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
