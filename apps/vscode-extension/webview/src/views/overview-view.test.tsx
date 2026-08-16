import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { EvolutionData, RepositoryData } from '@project-dna/shared';
import { OverviewView } from './overview-view.js';

describe('overview health and risk intelligence', () => {
  it('renders the health hero, real metrics, and repository summary', () => {
    const markup = renderToStaticMarkup(<OverviewView {...viewProps(repositoryData())} />);

    expect(markup).toContain('Repository health');
    expect(markup).toContain('84/100');
    expect(markup).toContain('Architecture evidence');
    expect(markup).toContain('Repository summary');
    expect(markup).toContain('12');
    expect(markup).toContain('3');
    expect(markup).toContain('pnpm');
    expect(markup).toContain('role="progressbar"');
    expect(markup).toContain('aria-label="Parsed coverage: 75%"');
  });

  it('renders categorical severity as text and accessible four-level indicators', () => {
    const markup = renderToStaticMarkup(
      <OverviewView {...viewProps(repositoryData({ includeRisks: true }))} />,
    );

    expect(markup.match(/role="img"/gu)).toHaveLength(4);
    expect(markup).toContain('aria-label="Severity: Low"');
    expect(markup).toContain('aria-label="Severity: Medium"');
    expect(markup).toContain('aria-label="Severity: High"');
    expect(markup).toContain('aria-label="Severity: Critical"');
    expect(markup).toContain('>Low</span>');
    expect(markup).toContain('>Medium</span>');
    expect(markup).toContain('>High</span>');
    expect(markup).toContain('>Critical</span>');
    expect(markup).toContain('bg-[var(--vscode-testing-iconPassed)]');
    expect(markup).toContain('bg-[var(--vscode-editorWarning-foreground)]');
    expect(markup).toContain('bg-[var(--vscode-charts-orange,#f59e0b)]');
    expect(markup).toContain('bg-[var(--vscode-editorError-foreground)]');
    expect(markup).toContain('Affects 2 entities');
  });

  it('keeps refresh and evolution controls as native accessible actions', () => {
    const markup = renderToStaticMarkup(
      <OverviewView {...viewProps(repositoryData())} evolution={evolutionData()} />,
    );

    expect(markup).toContain('aria-label="Refresh repository intelligence"');
    expect(markup).toContain('type="button"');
    expect(markup).toContain('Compare snapshots');
    expect(markup).toContain('aria-label="Critical components"');
  });

  it('preserves explicit empty, unavailable, and error states', () => {
    expect(renderToStaticMarkup(<OverviewView {...viewProps(null)} />)).toContain(
      'Repository overview data is not available.',
    );

    const unavailable = repositoryData({ parsed: 0, scanned: 0 });
    const unavailableMarkup = renderToStaticMarkup(<OverviewView {...viewProps(unavailable)} />);
    expect(unavailableMarkup).toContain('Repository health');
    expect(unavailableMarkup).toContain('Unavailable');
    expect(unavailableMarkup).toContain('No parsed files available for health analysis.');
    expect(unavailableMarkup).not.toContain('aria-label="Overall health:');

    const errorMarkup = renderToStaticMarkup(
      <OverviewView {...viewProps(repositoryData())} error="Analysis warning" />,
    );
    expect(errorMarkup).toContain('aria-live="polite"');
    expect(errorMarkup).toContain('role="status"');
    expect(errorMarkup).toContain('Analysis warning');
  });
});

function viewProps(data: RepositoryData | null) {
  return {
    data,
    evolution: null,
    error: null,
    onCompareEvolution: () => undefined,
    onOpenWorkspaceTarget: () => undefined,
    onRefresh: () => undefined,
  };
}

function repositoryData(
  options: { includeRisks?: boolean; parsed?: number; scanned?: number } = {},
) {
  const parsed = options.parsed ?? 3;
  const scanned = options.scanned ?? 4;
  return {
    name: 'fixture',
    description: 'Repository summary',
    rootPath: 'C:/repo',
    version: 3,
    analyzedAt: 1,
    durationMs: 100,
    projectType: 'service',
    repositorySize: 'small',
    packageManager: 'pnpm',
    testFramework: 'vitest',
    ciSystem: 'github-actions',
    languages: [],
    frameworks: [],
    counts: { modules: 3, entities: 12, domains: 2, capabilities: 4, knowledgeNodes: 5, risks: 4 },
    coverage: { scanned, parsed, skipped: 1, failed: 0 },
    health: {
      overallScore: 84,
      trend: 'improving',
      dimensions: {
        architectureHealth: 90,
        dependencyHealth: 80,
        complexityHealth: 75,
        knowledgeHealth: 70,
        riskHealth: 65,
      },
    },
    complexity: {
      averageComplexity: 2,
      maxComplexity: 5,
      mostComplexFile: 'src/core.ts',
      complexCodePercentage: 10,
      averageNestingDepth: 2,
      maxNestingDepth: 4,
    },
    risks: {
      overallRiskScore: 32,
      totalRisks: options.includeRisks ? 4 : 0,
      bySeverity: { critical: 1, high: 1, medium: 1, low: 1, info: 0 },
      topRisks: options.includeRisks
        ? [
            risk('low', 'Minor duplication', 1),
            risk('medium', 'Growing module', 2),
            risk('high', 'Dependency hub', 3),
            risk('critical', 'Cycle detected', 2),
          ]
        : [],
    },
    criticalComponents: [
      {
        name: 'Core service',
        path: 'src/core.ts',
        criticality: 'high',
        score: 0.9,
        reason: 'Central dependency hub',
      },
    ],
    story: {
      summary: 'Repository summary',
      healthSummary: 'Health is improving.',
      criticalPath: 'src/core.ts',
      risks: [],
    },
  } satisfies RepositoryData;
}

function risk(severity: string, description: string, affectedEntityCount: number) {
  return {
    type: `${severity}-risk`,
    severity,
    description,
    affectedEntityCount,
  };
}

function evolutionData(): EvolutionData {
  return {
    latestSnapshot: {
      id: 's2',
      version: 2,
      timestamp: 1,
      trigger: 'manual',
      projectDnaHash: 'hash',
      gitCommitHash: 'abc',
      metrics: { health: 84 },
      isFullSnapshot: true,
    },
    history: [
      {
        id: 's1',
        version: 1,
        timestamp: 1,
        trigger: 'manual',
        projectDnaHash: 'old-hash',
        gitCommitHash: 'old-abc',
        metrics: { health: 78 },
        isFullSnapshot: true,
      },
      {
        id: 's2',
        version: 2,
        timestamp: 1,
        trigger: 'manual',
        projectDnaHash: 'hash',
        gitCommitHash: 'abc',
        metrics: { health: 84 },
        isFullSnapshot: true,
      },
    ],
  };
}
