/** Internal parser strategy contracts. */

import type { SourceFile } from 'ts-morph';
import type { Result } from '@project-dna/shared/src/result/result.js';
import type Parser from 'web-tree-sitter';

export interface TypeScriptParseTree {
  readonly kind: 'typescript';
  readonly sourceFile: SourceFile;
  readonly content: string;
  readonly language: string;
}

export interface TreeSitterParseTree {
  readonly kind: 'tree-sitter';
  readonly tree: Parser.Tree;
  readonly content: string;
  readonly language: string;
}

export type RawParseTree = TypeScriptParseTree | TreeSitterParseTree;

export interface IParser {
  parse(content: string, language: string, filePath?: string): Promise<Result<RawParseTree>>;
}

export function isTypeScriptParseTree(tree: RawParseTree): tree is TypeScriptParseTree {
  return tree.kind === 'typescript';
}

export function isTreeSitterParseTree(tree: RawParseTree): tree is TreeSitterParseTree {
  return tree.kind === 'tree-sitter';
}
