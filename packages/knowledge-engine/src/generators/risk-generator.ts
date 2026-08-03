/**
 * @module RiskGenerator
 * Detects project risks and generates RiskNodes.
 */
import type { FileDNA, RepositoryGraph, RiskNode } from '@project-dna/dna-core';
import { riskNode } from './generator-utils.js';

export class RiskGenerator {
  public generate(files: FileDNA[], graph: RepositoryGraph, detectedAt = Date.now()): RiskNode[] {
    const risks: RiskNode[] = [];

    for (const file of files) {
      if (file.complexity >= 20) {
        risks.push(
          riskNode({
            type: 'high-complexity',
            severity:
              file.complexity >= 40 ? 'critical' : file.complexity >= 30 ? 'high' : 'medium',
            affectedEntities: [file.path],
            description: `${file.path} has cyclomatic complexity ${file.complexity}.`,
            measuredValue: file.complexity,
            threshold: 20,
            suggestion: 'Split complex logic into smaller functions and reduce branching.',
            detectedAt,
          }),
        );
      }
      if (file.linesOfCode >= 500) {
        risks.push(
          riskNode({
            type: 'large-file',
            severity: file.linesOfCode >= 1000 ? 'high' : 'medium',
            affectedEntities: [file.path],
            description: `${file.path} contains ${file.linesOfCode} lines of code.`,
            measuredValue: file.linesOfCode,
            threshold: 500,
            suggestion: 'Split the file along clear responsibilities or module boundaries.',
            detectedAt,
          }),
        );
      }
      if (file.imports.length >= 20) {
        risks.push(
          riskNode({
            type: 'excessive-imports',
            severity: file.imports.length >= 40 ? 'high' : 'medium',
            affectedEntities: [file.path],
            description: `${file.path} imports ${file.imports.length} modules.`,
            measuredValue: file.imports.length,
            threshold: 20,
            suggestion: 'Review responsibilities and introduce narrower module interfaces.',
            detectedAt,
          }),
        );
      }
    }

    const fileNodes = new Set(graph.getNodesByKind('file'));
    const cycles = findCycles(graph, fileNodes);
    for (const cycle of cycles) {
      risks.push(
        riskNode({
          type: 'circular-dependency',
          severity: cycle.length >= 4 ? 'high' : 'medium',
          affectedEntities: cycle,
          description: `Circular dependency detected across ${cycle.length} files.`,
          measuredValue: cycle.length,
          threshold: 1,
          suggestion: 'Break the cycle by extracting shared contracts or inverting a dependency.',
          detectedAt,
        }),
      );
    }

    for (const file of files) {
      if (!fileNodes.has(file.path) && !fileNodes.has(file.id)) continue;
      const nodeId = fileNodes.has(file.path) ? file.path : file.id;
      const internalDependencies = graph
        .getDependencies(nodeId)
        .filter((dependency) => fileNodes.has(dependency));
      const internalDependents = graph
        .getDependents(nodeId)
        .filter((dependent) => fileNodes.has(dependent));
      if (
        internalDependencies.length === 0 &&
        internalDependents.length === 0 &&
        files.length > 1
      ) {
        risks.push(
          riskNode({
            type: 'orphan-file',
            severity: 'low',
            affectedEntities: [file.path],
            description: `${file.path} has no incoming or outgoing file dependencies.`,
            suggestion:
              'Confirm that the file is an intentional entry point, fixture, or dead code.',
            detectedAt,
          }),
        );
      }
      const coupling = internalDependencies.length + internalDependents.length;
      const instability = coupling === 0 ? 0 : internalDependencies.length / coupling;
      if (internalDependencies.length >= 8 && instability >= 0.8) {
        risks.push(
          riskNode({
            type: 'unstable-module',
            severity: internalDependencies.length >= 15 ? 'high' : 'medium',
            affectedEntities: [file.path],
            description: `${file.path} depends on ${internalDependencies.length} internal files with instability ${instability.toFixed(2)}.`,
            measuredValue: Number(instability.toFixed(3)),
            threshold: 0.8,
            suggestion: 'Reduce outward coupling or introduce a stable module boundary.',
            detectedAt,
          }),
        );
      }
    }

    const barrelFiles = files.filter(
      (file) =>
        file.exports.length > 0 &&
        file.exports.every((item) => item.type === 'barrel' || item.type === 're-export'),
    );
    for (const file of barrelFiles.filter((candidate) => candidate.exports.length >= 15)) {
      risks.push(
        riskNode({
          type: 'barrel-explosion',
          severity: file.exports.length >= 30 ? 'high' : 'medium',
          affectedEntities: [file.path],
          description: `${file.path} re-exports ${file.exports.length} symbols or modules.`,
          measuredValue: file.exports.length,
          threshold: 15,
          suggestion: 'Split broad barrel exports or expose narrower public entry points.',
          detectedAt,
        }),
      );
    }

    return risks.sort(
      (left, right) => left.type.localeCompare(right.type) || left.id.localeCompare(right.id),
    );
  }
}

function findCycles(graph: RepositoryGraph, fileNodes: Set<string>): string[][] {
  const state = new Map<string, 'visiting' | 'visited'>();
  const stack: string[] = [];
  const positions = new Map<string, number>();
  const cycles = new Map<string, string[]>();

  const visit = (node: string): void => {
    state.set(node, 'visiting');
    positions.set(node, stack.length);
    stack.push(node);
    for (const dependency of graph
      .getDependencies(node)
      .filter((id) => fileNodes.has(id))
      .sort()) {
      if (!state.has(dependency)) {
        visit(dependency);
      } else if (state.get(dependency) === 'visiting') {
        const start = positions.get(dependency);
        if (start === undefined) continue;
        const cycle = canonicalize(stack.slice(start));
        cycles.set(cycle.join('>'), cycle);
      }
    }
    stack.pop();
    positions.delete(node);
    state.set(node, 'visited');
  };

  for (const node of [...fileNodes].sort()) {
    if (!state.has(node)) visit(node);
  }
  return [...cycles.values()];
}

function canonicalize(cycle: string[]): string[] {
  const rotations = cycle.map((_, index) => [...cycle.slice(index), ...cycle.slice(0, index)]);
  rotations.sort((left, right) => left.join('>').localeCompare(right.join('>')));
  return rotations[0] ?? cycle;
}
