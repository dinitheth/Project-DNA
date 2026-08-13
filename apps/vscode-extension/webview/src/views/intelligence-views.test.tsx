import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ArchitectureData, DependencyData } from '@project-dna/shared';
import { ArchitectureView } from './architecture-view.js';
import { DependenciesView } from './dependencies-view.js';

describe('architecture and dependency views', () => {
  it('renders architecture layers and evidence as labelled nested trees', () => {
    const markup = renderToStaticMarkup(<ArchitectureView data={architectureData()} />);

    expect(markup).toContain('aria-label="Architecture layers"');
    expect(markup).toContain('aria-label="Architecture detection evidence"');
    expect(markup).toContain('Domain Layer');
    expect(markup).toContain('src/domain');
    expect(markup).toContain('Matched path');
  });

  it('renders dependency hotspots as a labelled tree with relationship details', () => {
    const markup = renderToStaticMarkup(<DependenciesView data={dependencyData()} />);

    expect(markup).toContain('aria-label="Dependency connection hotspots"');
    expect(markup).toContain('Core service');
    expect(markup).toContain('3 dependents');
    expect(markup).toContain('5 total connections');
  });

  it('keeps explicit empty states when intelligence is unavailable', () => {
    expect(renderToStaticMarkup(<ArchitectureView data={null} />)).toContain(
      'Architecture intelligence is not available.',
    );
    expect(renderToStaticMarkup(<DependenciesView data={null} />)).toContain(
      'Dependency intelligence is not available.',
    );
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
