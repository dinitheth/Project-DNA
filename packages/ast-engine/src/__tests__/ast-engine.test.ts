import { describe, expect, it } from 'vitest';
import { createSilentLogger, isErr } from '@project-dna/shared';
import { AstEngine } from '../ast-engine.js';

const source = `
import React, { type ReactNode as NodeType, useMemo } from 'react';
import * as path from 'node:path';

/** Greets a person. */
export function greet(name: string, excited = false): string {
  if (excited && name) return \`Hello \${name}!\`;
  return \`Hello \${name}\`;
}

export const double = (value: number): number => value * 2;

@sealed()
export class Service extends Base implements Runnable {
  private readonly prefix: string = 'value';

  public async run(input?: string): Promise<string> {
    return input ?? this.prefix;
  }
}

export { thing as renamed } from './thing';
export * from './types';
const lazy = () => import('./lazy');
`;

describe('AstEngine', () => {
  it('extracts deterministic DNA from TypeScript source', async () => {
    const engine = new AstEngine(createSilentLogger());
    const result = await engine.parseFile({
      path: 'C:/repo/src/service.ts',
      relativePath: 'src/service.ts',
      content: source,
      language: 'typescript',
    });
    if (isErr(result)) throw result.error;

    expect(result.value.fileDna.path).toBe('src/service.ts');
    expect(result.value.fileDna.classIds).toHaveLength(1);
    expect(result.value.fileDna.functionIds).toHaveLength(3);
    expect(result.value.fileDna.imports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'react', isDynamic: false }),
        expect.objectContaining({ source: 'node:path', isDynamic: false }),
        expect.objectContaining({ source: './lazy', isDynamic: true }),
      ]),
    );
    expect(result.value.fileDna.exports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'greet', type: 'named' }),
        expect.objectContaining({ name: 'renamed', type: 're-export', source: './thing' }),
        expect.objectContaining({ name: '*', type: 'barrel', source: './types' }),
      ]),
    );
    expect(result.value.fileDna.comments).toContainEqual(
      expect.objectContaining({ type: 'doc', text: 'Greets a person.' }),
    );
    expect(result.value.fileDna.complexity).toBeGreaterThan(1);

    expect(result.value.functions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'greet', isArrow: false, complexity: 3 }),
        expect.objectContaining({ name: 'double', isArrow: true }),
        expect.objectContaining({ name: 'lazy', isArrow: true }),
      ]),
    );
    expect(result.value.classes[0]).toMatchObject({
      name: 'Service',
      extends: 'Base',
      implements: ['Runnable'],
      decorators: ['sealed'],
      isExported: true,
    });
    expect(result.value.classes[0]?.properties[0]).toMatchObject({
      name: 'prefix',
      visibility: 'private',
      isReadonly: true,
      hasDefaultValue: true,
    });
  });

  it('streams results and reports unsupported languages without throwing', async () => {
    const engine = new AstEngine(createSilentLogger());
    const results = [];

    for await (const result of engine.parseFiles([
      { path: 'one.ts', content: 'export const one = 1;', language: 'typescript' },
      { path: 'two.py', content: 'value = 2', language: 'python' },
    ])) {
      results.push(result);
    }

    expect(results).toHaveLength(2);
    expect(results[0]?.ok).toBe(true);
    expect(results[1]?.ok).toBe(false);
  });

  it('honors cancellation', async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await new AstEngine(createSilentLogger()).parseFile(
      { path: 'cancel.ts', content: '', language: 'typescript' },
      controller.signal,
    );
    expect(isErr(result)).toBe(true);
  });
});
