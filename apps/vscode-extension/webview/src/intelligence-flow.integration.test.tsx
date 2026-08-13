import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ExtensionMessageSchema } from '@project-dna/shared';
import { createExtensionMessageListener } from './hooks/useMessage.js';
import { initialAnalysisState, reduceAnalysisState } from './state/analysis-state.js';
import { ArchitectureView } from './views/architecture-view.js';
import { DependenciesView } from './views/dependencies-view.js';
import { KnowledgeView } from './views/knowledge-view.js';
import { OverviewView } from './views/overview-view.js';

describe('intelligence snapshot webview integration', () => {
  it('validates one atomic snapshot and renders every intelligence surface from accepted state', () => {
    let state = initialAnalysisState;
    const listener = createExtensionMessageListener((message) => {
      state = reduceAnalysisState(state, message);
    });

    listener({ data: snapshot() } as MessageEvent<unknown>);

    expect(state.status).toBe('ready');
    expect(
      renderToStaticMarkup(
        <ArchitectureView data={state.architecture} onOpenWorkspaceTarget={() => undefined} />,
      ),
    ).toContain('Domain Layer');
    expect(
      renderToStaticMarkup(
        <DependenciesView data={state.dependencies} onOpenWorkspaceTarget={() => undefined} />,
      ),
    ).toContain('Repository service');
    expect(
      renderToStaticMarkup(
        <KnowledgeView
          data={state.knowledge}
          onOpenWorkspaceTarget={() => undefined}
          onSelectEntity={() => undefined}
          semanticGraph={state.semanticGraph}
        />,
      ),
    ).toContain('Serves → Orders');
    expect(
      renderToStaticMarkup(
        <OverviewView
          data={state.repository}
          error={state.error}
          evolution={state.evolution}
          onCompareEvolution={() => undefined}
          onOpenWorkspaceTarget={() => undefined}
          onRefresh={() => undefined}
        />,
      ),
    ).toContain('Latest snapshot v1');
  });
});

function snapshot() {
  return ExtensionMessageSchema.parse({
    type: 'analysisSnapshot',
    version: 1,
    data: {
      repository: {
        name: 'Project DNA',
        description: 'Repository intelligence fixture',
        rootPath: '/workspace/project-dna',
        version: 1,
        analyzedAt: 1,
        durationMs: 10,
        projectType: 'service',
        repositorySize: 'small',
        packageManager: 'pnpm',
        testFramework: 'vitest',
        ciSystem: 'github-actions',
        languages: [],
        frameworks: [],
        counts: {
          modules: 1,
          entities: 1,
          domains: 1,
          capabilities: 1,
          knowledgeNodes: 1,
          risks: 1,
        },
        coverage: { scanned: 1, parsed: 1, skipped: 0, failed: 0 },
        health: {
          overallScore: 90,
          trend: 'stable',
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
          totalRisks: 1,
          bySeverity: { critical: 0, high: 0, medium: 1, low: 0, info: 0 },
          topRisks: [
            {
              type: 'dependency-hub',
              severity: 'medium',
              description: 'Repository service has high connectivity.',
              affectedEntityCount: 1,
            },
          ],
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
        story: {
          summary: 'Repository intelligence is available.',
          healthSummary: 'Healthy',
          criticalPath: 'Repository service',
          risks: ['Dependency hub'],
        },
      },
      architecture: {
        pattern: 'layered',
        confidence: 0.9,
        detectedAt: 1,
        detectedPatterns: [{ pattern: 'layered', confidence: 0.9 }],
        layers: [
          { name: 'domain-layer', role: 'domain', fileCount: 1, directories: ['src/domain'] },
        ],
        evidence: [],
        summary: 'Layered architecture detected.',
      },
      dependencies: {
        nodeCount: 1,
        edgeCount: 1,
        nodeKinds: { files: 1, modules: 0, packages: 0, external: 0 },
        edgeTypes: { imports: 1, reExports: 0, dynamicImports: 0, requires: 0, typeImports: 0 },
        hotspots: [
          {
            id: 'repository-service',
            label: 'Repository service',
            path: 'src/service.ts',
            kind: 'file',
            dependencies: 1,
            dependents: 0,
            totalConnections: 1,
          },
        ],
      },
      knowledge: {
        domains: [],
        capabilities: [],
        nodes: [
          {
            name: 'Repository service',
            type: 'component',
            sourceRef: 'src/service.ts',
            tags: [],
            relationshipCount: 1,
          },
        ],
      },
      semanticGraph: {
        nodeCount: 2,
        edgeCount: 1,
        truncated: false,
        nodes: [
          {
            id: 'service',
            label: 'Repository service',
            kind: 'component',
            weight: 0.9,
            incomingRelationshipCount: 0,
            outgoingRelationshipCount: 1,
          },
          {
            id: 'orders',
            label: 'Orders',
            kind: 'domain',
            weight: 0.8,
            incomingRelationshipCount: 1,
            outgoingRelationshipCount: 0,
          },
        ],
        edges: [
          { source: 'service', target: 'orders', kind: 'serves', weight: 0.9, confidence: 0.9 },
        ],
      },
      evolution: {
        latestSnapshot: {
          id: 'snapshot-1',
          version: 1,
          timestamp: 1,
          trigger: 'manual',
          projectDnaHash: 'hash',
          gitCommitHash: null,
          metrics: { health: 90 },
          isFullSnapshot: true,
        },
        history: [
          {
            id: 'snapshot-1',
            version: 1,
            timestamp: 1,
            trigger: 'manual',
            projectDnaHash: 'hash',
            gitCommitHash: null,
            metrics: { health: 90 },
            isFullSnapshot: true,
          },
        ],
      },
    },
  });
}
