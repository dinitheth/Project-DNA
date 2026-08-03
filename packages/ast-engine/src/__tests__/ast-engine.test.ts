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

  it('streams supported results and reports unsupported languages without throwing', async () => {
    const engine = new AstEngine(createSilentLogger());
    const results = [];

    for await (const result of engine.parseFiles([
      { path: 'one.ts', content: 'export const one = 1;', language: 'typescript' },
      { path: 'two.py', content: 'value = 2', language: 'python' },
      { path: 'three.rb', content: 'class Three; end', language: 'ruby' },
    ])) {
      results.push(result);
    }

    expect(results).toHaveLength(3);
    expect(results[0]?.ok).toBe(true);
    expect(results[1]?.ok).toBe(true);
    expect(results[2]?.ok).toBe(false);
  });

  it('extracts Python structure through the Tree-sitter WASM parser', async () => {
    const result = await new AstEngine(createSilentLogger()).parseFile({
      path: 'C:/repo/service.py',
      relativePath: 'service.py',
      language: 'python',
      content: `from pathlib import Path as FilePath\n\nclass Service(Base):\n    value: str = "ready"\n\n    def run(self, name: str = "world") -> str:\n        if name:\n            return name\n        return self.value\n\nasync def fetch(url: str):\n    # fetch the resource\n    return await request(url)\n`,
    });
    if (isErr(result)) throw result.error;

    expect(result.value.fileDna.language).toBe('python');
    expect(result.value.fileDna.imports).toEqual(
      expect.arrayContaining([expect.objectContaining({ source: 'pathlib' })]),
    );
    expect(result.value.fileDna.exports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Service' }),
        expect.objectContaining({ name: 'fetch' }),
      ]),
    );
    expect(result.value.classes[0]).toMatchObject({
      name: 'Service',
      extends: 'Base',
      isExported: true,
    });
    expect(result.value.classes[0]?.methods[0]).toMatchObject({
      name: 'run',
      parameters: expect.arrayContaining([
        expect.objectContaining({ name: 'name', isOptional: true }),
      ]),
    });
    expect(result.value.functions).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'fetch', isAsync: true })]),
    );
    expect(result.value.fileDna.comments).toContainEqual(
      expect.objectContaining({ text: 'fetch the resource', type: 'line' }),
    );
    expect(result.value.fileDna.complexity).toBeGreaterThan(1);
  });

  it('extracts Go structs, receiver methods, imports, and exported functions', async () => {
    const result = await new AstEngine(createSilentLogger()).parseFile({
      path: 'C:/repo/service.go',
      relativePath: 'service.go',
      language: 'go',
      content: `package service

import "fmt"

type Service struct {
    Name string
    count int
}

func (service *Service) Run(name string) string {
    if name != "" {
        return fmt.Sprint(name)
    }
    return service.Name
}

func Build(name string) *Service {
    return &Service{Name: name}
}
`,
    });
    if (isErr(result)) throw result.error;

    expect(result.value.fileDna.imports).toContainEqual(expect.objectContaining({ source: 'fmt' }));
    expect(result.value.fileDna.exports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Service' }),
        expect.objectContaining({ name: 'Build' }),
      ]),
    );
    expect(result.value.classes[0]).toMatchObject({
      name: 'Service',
      isExported: true,
      methods: [expect.objectContaining({ name: 'Run', visibility: 'public' })],
      properties: expect.arrayContaining([
        expect.objectContaining({ name: 'Name', type: 'string', visibility: 'public' }),
        expect.objectContaining({ name: 'count', type: 'int', visibility: 'private' }),
      ]),
    });
    expect(result.value.functions).toContainEqual(
      expect.objectContaining({ name: 'Build', returnType: '*Service', isExported: true }),
    );
    expect(result.value.fileDna.complexity).toBeGreaterThan(1);
  });

  it('extracts Java classes, inheritance, fields, methods, and imports', async () => {
    const result = await new AstEngine(createSilentLogger()).parseFile({
      path: 'C:/repo/Service.java',
      relativePath: 'Service.java',
      language: 'java',
      content: `package demo;

import java.util.List;

public class Service extends Base implements Runnable, AutoCloseable {
    private final String name = "dna";

    public String run(String input) {
        if (input.isEmpty()) {
            return name;
        }
        return input;
    }

    public void close() {}
}
`,
    });
    if (isErr(result)) throw result.error;

    expect(result.value.fileDna.imports).toContainEqual(
      expect.objectContaining({ source: 'java.util.List' }),
    );
    expect(result.value.fileDna.exports).toContainEqual(
      expect.objectContaining({ name: 'Service' }),
    );
    expect(result.value.classes[0]).toMatchObject({
      name: 'Service',
      extends: 'Base',
      implements: ['Runnable', 'AutoCloseable'],
      isExported: true,
      methods: expect.arrayContaining([
        expect.objectContaining({ name: 'run', visibility: 'public', complexity: 2 }),
        expect.objectContaining({ name: 'close', visibility: 'public' }),
      ]),
      properties: [
        expect.objectContaining({
          name: 'name',
          type: 'String',
          visibility: 'private',
          isReadonly: true,
          hasDefaultValue: true,
        }),
      ],
    });
  });

  it('extracts Rust structs, impl methods, use declarations, and public functions', async () => {
    const result = await new AstEngine(createSilentLogger()).parseFile({
      path: 'C:/repo/service.rs',
      relativePath: 'service.rs',
      language: 'rust',
      content: `use std::collections::HashMap;

pub struct Service {
    pub name: String,
    count: usize,
}

impl Service {
    pub fn run(&self, value: i32) -> i32 {
        if value > 0 { value } else { 0 }
    }
}

pub async fn build(name: String) -> Service {
    Service { name, count: 0 }
}
`,
    });
    if (isErr(result)) throw result.error;

    expect(result.value.fileDna.imports).toContainEqual(
      expect.objectContaining({ source: 'std::collections::HashMap' }),
    );
    expect(result.value.fileDna.exports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Service' }),
        expect.objectContaining({ name: 'build' }),
      ]),
    );
    expect(result.value.classes[0]).toMatchObject({
      name: 'Service',
      isExported: true,
      methods: [
        expect.objectContaining({
          name: 'run',
          visibility: 'public',
          parameters: [expect.objectContaining({ name: 'value', type: 'i32' })],
        }),
      ],
      properties: expect.arrayContaining([
        expect.objectContaining({ name: 'name', type: 'String', visibility: 'public' }),
        expect.objectContaining({ name: 'count', type: 'usize', visibility: 'private' }),
      ]),
    });
    expect(result.value.functions).toContainEqual(
      expect.objectContaining({ name: 'build', isAsync: true, isExported: true }),
    );
  });

  it('extracts C# classes, base types, fields, methods, and using directives', async () => {
    const result = await new AstEngine(createSilentLogger()).parseFile({
      path: 'C:/repo/Service.cs',
      relativePath: 'Service.cs',
      language: 'csharp',
      content: `using System;
using System.Threading.Tasks;

namespace Demo {
    public class Service : BaseService, IDisposable {
        private readonly string name = "dna";

        public async Task<string> RunAsync(string input = "ready") {
            if (input.Length > 0) {
                return input;
            }
            return name;
        }

        public void Dispose() {}
    }
}
`,
    });
    if (isErr(result)) throw result.error;

    expect(result.value.fileDna.imports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'System' }),
        expect.objectContaining({ source: 'System.Threading.Tasks' }),
      ]),
    );
    expect(result.value.fileDna.exports).toContainEqual(
      expect.objectContaining({ name: 'Service' }),
    );
    expect(result.value.classes[0]).toMatchObject({
      name: 'Service',
      extends: 'BaseService',
      implements: ['IDisposable'],
      isExported: true,
      methods: expect.arrayContaining([
        expect.objectContaining({
          name: 'RunAsync',
          visibility: 'public',
          isAsync: true,
          parameters: [expect.objectContaining({ name: 'input', isOptional: true })],
        }),
        expect.objectContaining({ name: 'Dispose', visibility: 'public' }),
      ]),
      properties: [
        expect.objectContaining({
          name: 'name',
          type: 'string',
          visibility: 'private',
          isReadonly: true,
          hasDefaultValue: true,
        }),
      ],
    });
    expect(result.value.fileDna.complexity).toBeGreaterThan(1);
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
