import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMMAND_IDS, EXTENSION_ID, VIEW_IDS } from '@project-dna/shared';

interface ExtensionManifest {
  readonly name: string;
  readonly publisher: string;
  readonly contributes: {
    readonly commands: ReadonlyArray<{ readonly command: string }>;
    readonly views: Readonly<Record<string, ReadonlyArray<{ readonly id: string }>>>;
  };
}

const manifestPath = path.resolve(__dirname, '../../package.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as ExtensionManifest;

describe('VS Code extension manifest', () => {
  it('composes the exported extension identifier from publisher and name', () => {
    expect(`${manifest.publisher}.${manifest.name}`).toBe(EXTENSION_ID);
  });

  it('contributes every exported command exactly once', () => {
    const manifestCommandIds = manifest.contributes.commands.map(({ command }) => command);
    const exportedCommandIds = Object.values(COMMAND_IDS);

    expect(findDuplicates(manifestCommandIds)).toEqual([]);
    expect(findMissing(exportedCommandIds, manifestCommandIds)).toEqual([]);
    expect(findMissing(manifestCommandIds, exportedCommandIds)).toEqual([]);
  });

  it('contributes the exported sidebar webview exactly once', () => {
    const contributedViewIds = Object.values(manifest.contributes.views)
      .flat()
      .map(({ id }) => id);

    expect(findDuplicates(contributedViewIds)).toEqual([]);
    expect(contributedViewIds.filter((viewId) => viewId === VIEW_IDS.sidebar)).toEqual([
      VIEW_IDS.sidebar,
    ]);
  });
});

function findDuplicates(values: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([value]) => value)
    .sort((left, right) => left.localeCompare(right));
}

function findMissing(expected: readonly string[], actual: readonly string[]): string[] {
  const actualValues = new Set(actual);
  return expected
    .filter((value) => !actualValues.has(value))
    .sort((left, right) => left.localeCompare(right));
}
