import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type {
  ArchitectureData,
  DependencyData,
  EvolutionData,
  RepositoryData,
} from '@project-dna/shared';
import type { KnowledgeData, SemanticGraphData } from '@project-dna/shared';
import { ArchitectureView } from './architecture-view.js';
import { DependenciesView } from './dependencies-view.js';
import { KnowledgeView } from './knowledge-view.js';

describe('architecture and dependency views', () => {
  it('renders architecture layers and evidence as labelled nested trees', () => {
    const markup = renderToStaticMarkup(
      <ArchitectureView data={architectureData()} onOpenWorkspaceTarget={() => undefined} />,
    );

    expect(markup).toContain('aria-label="Architecture layers"');
    expect(markup).toContain('aria-label="Architecture detection evidence"');
    expect(markup).toContain('Domain Layer');
    expect(markup).toContain('src/domain');
    expect(markup).toContain('Matched path');
  });

  it('renders dependency hotspots as a labelled tree with relationship details', () => {
    const markup = renderToStaticMarkup(
      <DependenciesView data={dependencyData()} onOpenWorkspaceTarget={() => undefined} />,
    );

    expect(markup).toContain('aria-label="Dependency connection hotspots"');
    expect(markup).toContain('Core service');
    expect(markup).toContain('3 dependents');
    expect(markup).toContain('5 total connections');
  });

  it('keeps explicit empty states when intelligence is unavailable', () => {
    expect(
      renderToStaticMarkup(
        <ArchitectureView data={null} onOpenWorkspaceTarget={() => undefined} />,
      ),
    ).toContain('Architecture intelligence is not available.');
    expect(
      renderToStaticMarkup(
        <DependenciesView data={null} onOpenWorkspaceTarget={() => undefined} />,
      ),
    ).toContain('Dependency intelligence is not available.');
  });

  it('renders semantic knowledge nodes and their relationships', () => {
    const markup = renderToStaticMarkup(
      <KnowledgeView
        data={knowledgeData()}
        onOpenWorkspaceTarget={() => undefined}
        onSelectEntity={() => undefined}
        semanticGraph={semanticGraphData()}
      />,
    );
    expect(markup).toContain('aria-label="Semantic knowledge graph"');
    expect(markup).toContain('Order service');
    expect(markup).toContain('Serves → orders');
    expect(markup).toContain('2 nodes');
  });

  it('renders critical components and evolution snapshots in the overview', async () => {
    const { OverviewView } = await import('./overview-view.js');
    const markup = renderToStaticMarkup(
      <OverviewView
        data={repositoryData()}
        evolution={evolutionData()}
        error={null}
        onRefresh={() => undefined}
        onOpenWorkspaceTarget={() => undefined}
      />,
    );
    expect(markup).toContain('aria-label="Critical components"');
    expect(markup).toContain('Repository service');
    expect(markup).toContain('aria-label="Evolution snapshots"');
    expect(markup).toContain('Latest snapshot v3');
  });
});

function architectureData(): ArchitectureData {
  return {
    pattern: 'layered',
    confidence: 0.9,
    detectedAt: 1,
    detectedPatterns: [{ pattern: 'layered', confidence: 0.9 }],
    layers: [{ name: 'domain-layer', role: 'domain', fileCount: 3, directories: ['src/domain'] }],
    evidence: [
      {
        rule: 'domain-boundary',
        description: 'Domain imports remain inward.',
        matchedPaths: ['src/domain/order.ts'],
        weight: 0.8,
      },
    ],
    summary: 'Layered architecture detected.',
  };
}

function dependencyData(): DependencyData {
  return {
    nodeCount: 4,
    edgeCount: 5,
    nodeKinds: { files: 3, modules: 0, packages: 0, external: 1 },
    edgeTypes: { imports: 4, reExports: 0, dynamicImports: 1, requires: 0, typeImports: 0 },
    hotspots: [
      {
        id: 'core-service',
        label: 'Core service',
        path: 'src/core.ts',
        kind: 'file',
        dependencies: 2,
        dependents: 3,
        totalConnections: 5,
      },
    ],
  };
}

function knowledgeData(): KnowledgeData {
  return { domains: [], capabilities: [], nodes: [] };
}

function semanticGraphData(): SemanticGraphData {
  return {
    nodeCount: 2,
    edgeCount: 1,
    truncated: false,
    nodes: [
      {
        id: 'orders',
        label: 'Order service',
        kind: 'component',
        weight: 0.8,
        incomingRelationshipCount: 0,
        outgoingRelationshipCount: 1,
      },
      {
        id: 'orders-domain',
        label: 'orders',
        kind: 'domain',
        weight: 0.6,
        incomingRelationshipCount: 1,
        outgoingRelationshipCount: 0,
      },
    ],
    edges: [
      {
        source: 'orders',
        target: 'orders-domain',
        kind: 'serves',
        weight: 0.8,
        confidence: 0.9,
      },
    ],
  };
}

function repositoryData(): RepositoryData {
  return {
    name: 'fixture',
    description: 'Fixture repository',
    rootPath: 'C:/repo',
    version: 3,
    analyzedAt: 1,
    durationMs: 100,
    projectType: 'service',
    repositorySize: 'small',
    packageManager: 'pnpm',
    testFramework: null,
    ciSystem: null,
    languages: [],
    frameworks: [],
    counts: { modules: 1, entities: 1, domains: 0, capabilities: 0, knowledgeNodes: 0, risks: 0 },
    coverage: { scanned: 1, parsed: 1, skipped: 0, failed: 0 },
    health: {
      overallScore: 90,
      trend: 'improving',
      dimensions: {
        architectureHealth: 90,
        dependencyHealth: 90,
        complexityHealth: 90,
        knowledgeHealth: 90,
        riskHealth: 90,
      },
    },
    complexity: {
      averageComplexity: 1,
      maxComplexity: 1,
      mostComplexFile: null,
      complexCodePercentage: 0,
      averageNestingDepth: 0,
      maxNestingDepth: 0,
    },
    risks: {
      overallRiskScore: 10,
      totalRisks: 0,
      bySeverity: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
      topRisks: [],
    },
    criticalComponents: [
      {
        name: 'Repository service',
        path: 'src/service.ts',
        criticality: 'high',
        score: 0.9,
        reason: 'Central dependency hub',
      },
    ],
    story: { summary: 'summary', healthSummary: 'healthy', criticalPath: 'service', risks: [] },
  };
}

function evolutionData(): EvolutionData {
  return {
    latestSnapshot: {
      id: 's3',
      version: 3,
      timestamp: 1,
      trigger: 'manual',
      projectDnaHash: 'hash',
      gitCommitHash: 'abc',
      metrics: { health: 90 },
      isFullSnapshot: true,
    },
    history: [
      {
        id: 's3',
        version: 3,
        timestamp: 1,
        trigger: 'manual',
        projectDnaHash: 'hash',
        gitCommitHash: 'abc',
        metrics: { health: 90 },
        isFullSnapshot: true,
      },
    ],
  };
}
