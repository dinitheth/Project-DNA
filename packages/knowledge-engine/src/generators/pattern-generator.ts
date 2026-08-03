/**
 * @module PatternGenerator
 * Detects patterns from files and graph.
 */
import type { FileDNA, RepositoryGraph, KnowledgeNode } from '@project-dna/dna-core';
import { knowledgeNode } from './generator-utils.js';

export class PatternGenerator {
  public generate(
    files: FileDNA[],
    graph: RepositoryGraph,
    createdAt = Date.now(),
  ): KnowledgeNode[] {
    const nodes: KnowledgeNode[] = [];
    const barrelFiles = files.filter(
      (file) =>
        file.exports.length > 0 &&
        file.exports.every((item) => item.type === 'barrel' || item.type === 're-export'),
    );
    if (barrelFiles.length > 0) {
      nodes.push(
        knowledgeNode({
          type: 'pattern',
          name: 'Barrel export pattern',
          metadata: {
            fileCount: barrelFiles.length,
            files: barrelFiles.map((file) => file.path).sort(),
            reExportCount: barrelFiles.reduce((sum, file) => sum + file.exports.length, 0),
          },
          tags: ['pattern', 'exports', 'barrel'],
          createdAt,
        }),
      );
    }

    const dynamicImports = files.flatMap((file) =>
      file.imports
        .filter((item) => item.isDynamic)
        .map((item) => ({ file: file.path, source: item.source })),
    );
    if (dynamicImports.length > 0) {
      nodes.push(
        knowledgeNode({
          type: 'pattern',
          name: 'Dynamic loading pattern',
          metadata: { occurrenceCount: dynamicImports.length, imports: dynamicImports },
          tags: ['pattern', 'dynamic-import', 'loading'],
          createdAt,
        }),
      );
    }

    const defaultExportFiles = files.filter((file) =>
      file.exports.some((item) => item.type === 'default'),
    );
    const namedExportFiles = files.filter((file) =>
      file.exports.some((item) => item.type === 'named'),
    );
    if (defaultExportFiles.length + namedExportFiles.length > 0) {
      const style = defaultExportFiles.length > namedExportFiles.length ? 'default' : 'named';
      nodes.push(
        knowledgeNode({
          type: 'convention',
          name: `Predominantly ${style} exports`,
          metadata: {
            style,
            defaultExportFiles: defaultExportFiles.length,
            namedExportFiles: namedExportFiles.length,
          },
          tags: ['convention', 'exports'],
          createdAt,
        }),
      );
    }

    const hubs = graph
      .getNodesByKind('file')
      .map((id) => ({ id, fanIn: graph.inDegree(id) }))
      .filter((item) => item.fanIn >= 5)
      .sort((left, right) => right.fanIn - left.fanIn || left.id.localeCompare(right.id));
    if (hubs.length > 0) {
      nodes.push(
        knowledgeNode({
          type: 'relationship',
          name: 'Dependency hub files',
          metadata: { hubs },
          tags: ['relationship', 'dependency', 'hub'],
          createdAt,
        }),
      );
    }

    return nodes.sort((left, right) => left.id.localeCompare(right.id));
  }
}
