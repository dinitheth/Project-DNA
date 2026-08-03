import type { ArchitectureEvidence, RepositoryGraph } from '@project-dna/dna-core';

export interface PathInventory {
  paths: string[];
  lowerPaths: string[];
}

export function inventory(graph: RepositoryGraph): PathInventory {
  const paths: string[] = [];
  graph.forEachNode((id, attrs) => {
    if (attrs.kind !== 'file') return;
    paths.push(normalizePath(attrs.path ?? id));
  });
  paths.sort();
  return { paths, lowerPaths: paths.map((path) => path.toLowerCase()) };
}

export function normalizePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+/g, '/');
}

export function matchingPaths(paths: string[], names: readonly string[]): string[] {
  const terms = names.map((name) => name.toLowerCase());
  return paths.filter((path) => {
    const segments = path.toLowerCase().split('/');
    return segments.some((segment) => terms.includes(segment));
  });
}

export function hasDirectory(paths: string[], name: string): boolean {
  return matchingPaths(paths, [name]).length > 0;
}

export function directionalMatches(
  graph: RepositoryGraph,
  sourceNames: readonly string[],
  targetNames: readonly string[],
): string[] {
  const nodes = new Map<string, string>();
  graph.forEachNode((id, attrs) => {
    if (attrs.kind === 'file') nodes.set(id, normalizePath(attrs.path ?? id));
  });
  const sourceTerms = sourceNames.map((name) => name.toLowerCase());
  const targetTerms = targetNames.map((name) => name.toLowerCase());
  const matches: string[] = [];
  graph.forEachEdge((_edge, _attributes, source, target) => {
    const sourcePath = nodes.get(source);
    const targetPath = nodes.get(target);
    if (!sourcePath || !targetPath) return;
    const sourceSegments = sourcePath.toLowerCase().split('/');
    const targetSegments = targetPath.toLowerCase().split('/');
    if (
      sourceSegments.some((segment) => sourceTerms.includes(segment)) &&
      targetSegments.some((segment) => targetTerms.includes(segment))
    ) {
      matches.push(`${sourcePath} -> ${targetPath}`);
    }
  });
  return matches.sort();
}

export function evidence(
  rule: string,
  description: string,
  matchedPaths: string[],
  weight: number,
): ArchitectureEvidence {
  return { rule, description, matchedPaths: [...matchedPaths].sort(), weight };
}

export function scoreSignals(
  signals: Array<{ matched: string[]; weight: number; rule: string; description: string }>,
): { confidence: number; evidence: ArchitectureEvidence[] } {
  const positive = signals.filter((signal) => signal.matched.length > 0);
  const total = positive.reduce((sum, signal) => sum + signal.weight, 0);
  const confidence = Math.min(0.98, Number(total.toFixed(3)));
  return {
    confidence,
    evidence: positive.map((signal) =>
      evidence(signal.rule, signal.description, signal.matched, Math.min(1, signal.weight)),
    ),
  };
}

export function noMatch(pattern: HeuristicResultPattern): {
  pattern: HeuristicResultPattern;
  confidence: number;
  evidence: ArchitectureEvidence[];
} {
  return { pattern, confidence: 0, evidence: [] };
}

export type HeuristicResultPattern =
  'mvc' | 'clean' | 'hexagonal' | 'ddd' | 'layered' | 'microservice';
