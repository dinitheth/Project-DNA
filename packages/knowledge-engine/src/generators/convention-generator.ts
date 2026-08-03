/**
 * @module ConventionGenerator
 * Detects coding conventions from the repository.
 */
import type { FileDNA, RepositoryDNA, KnowledgeNode } from '@project-dna/dna-core';
import { knowledgeNode, normalizePath } from './generator-utils.js';

export class ConventionGenerator {
  public generate(
    files: FileDNA[],
    repository: RepositoryDNA,
    createdAt = Date.now(),
  ): KnowledgeNode[] {
    const nodes: KnowledgeNode[] = [];
    const naming = detectNamingConvention(files);
    if (naming) {
      nodes.push(
        knowledgeNode({
          type: 'convention',
          name: `Dominant ${naming.style} file naming`,
          metadata: {
            style: naming.style,
            matchingFiles: naming.count,
            consideredFiles: naming.total,
            percentage: naming.percentage,
          },
          tags: ['convention', 'file-naming'],
          sourceRef: repository.rootPath,
          createdAt,
        }),
      );
    }

    const sourceRootCount = files.filter((file) =>
      normalizePath(file.path).startsWith('src/'),
    ).length;
    if (files.length >= 3 && sourceRootCount / files.length >= 0.6) {
      nodes.push(
        knowledgeNode({
          type: 'convention',
          name: 'Source files are organized under src/',
          metadata: {
            sourceRoot: 'src',
            matchingFiles: sourceRootCount,
            totalFiles: files.length,
            percentage: roundedPercentage(sourceRootCount, files.length),
          },
          tags: ['convention', 'folder-structure'],
          sourceRef: repository.rootPath,
          createdAt,
        }),
      );
    }

    const testFiles = files.filter((file) =>
      /(?:^|\/)(?:__tests__\/|test\/|tests\/)|\.(?:test|spec)\.[^.]+$/i.test(
        normalizePath(file.path),
      ),
    );
    if (testFiles.length > 0) {
      const colocated = testFiles.filter((file) =>
        /\.(?:test|spec)\.[^.]+$/i.test(file.path),
      ).length;
      const style = colocated >= testFiles.length / 2 ? 'co-located' : 'dedicated-directory';
      nodes.push(
        knowledgeNode({
          type: 'convention',
          name: `${style === 'co-located' ? 'Co-located' : 'Dedicated directory'} test layout`,
          metadata: { style, testFileCount: testFiles.length, colocatedCount: colocated },
          tags: ['convention', 'testing'],
          sourceRef: repository.rootPath,
          createdAt,
        }),
      );
    }

    return nodes.sort((left, right) => left.id.localeCompare(right.id));
  }
}

type NamingStyle = 'kebab-case' | 'camelCase' | 'PascalCase' | 'snake_case';

function detectNamingConvention(
  files: FileDNA[],
): { style: NamingStyle; count: number; total: number; percentage: number } | null {
  const counts = new Map<NamingStyle, number>();
  let total = 0;
  for (const file of files) {
    const filename = normalizePath(file.path).split('/').at(-1) ?? '';
    const stem = filename.replace(/(?:\.d)?\.[^.]+$/, '').replace(/\.(?:test|spec)$/, '');
    if (!stem || ['index', 'main'].includes(stem.toLowerCase())) continue;
    const style = classifyStyle(stem);
    if (!style) continue;
    counts.set(style, (counts.get(style) ?? 0) + 1);
    total++;
  }
  if (total < 3) return null;
  const ranked = [...counts.entries()].sort(
    ([leftStyle, leftCount], [rightStyle, rightCount]) =>
      rightCount - leftCount || leftStyle.localeCompare(rightStyle),
  );
  const winner = ranked[0];
  if (!winner || winner[1] / total < 0.7) return null;
  return {
    style: winner[0],
    count: winner[1],
    total,
    percentage: roundedPercentage(winner[1], total),
  };
}

function classifyStyle(stem: string): NamingStyle | null {
  if (/^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/.test(stem)) return 'kebab-case';
  if (/^[a-z][a-zA-Z0-9]*$/.test(stem) && /[A-Z]/.test(stem)) return 'camelCase';
  if (/^[A-Z][a-zA-Z0-9]*$/.test(stem)) return 'PascalCase';
  if (/^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/.test(stem)) return 'snake_case';
  return null;
}

function roundedPercentage(count: number, total: number): number {
  return Number(((count / total) * 100).toFixed(1));
}
