/** Internal parser strategy contracts. */

import type { SourceFile } from 'ts-morph';
import type { Result } from '@project-dna/shared';

export interface TypeScriptParseTree {
  readonly kind: 'typescript';
  readonly sourceFile: SourceFile;
  readonly content: string;
  readonly language: string;
}

export type RawParseTree = TypeScriptParseTree;

export interface IParser {
  parse(content: string, language: string, filePath?: string): Promise<Result<RawParseTree>>;
}

export function isTypeScriptParseTree(tree: RawParseTree): tree is TypeScriptParseTree {
  return tree.kind === 'typescript';
}
