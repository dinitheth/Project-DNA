/**
 * @module parser.interface
 * @description Internal interface for parser strategies.
 */

import type { Result } from '@project-dna/shared';

/**
 * Represents the raw syntax tree returned by the underlying parser.
 * This can be either a Tree-sitter tree or a ts-morph AST, depending on the parser.
 */
export type RawParseTree = any; // TODO: Refine this type based on the specific parser outputs

export interface IParser {
  /**
   * Parses the given content into a raw parse tree.
   * @param content The source code content to parse.
   * @param language The language of the source code.
   */
  parse(content: string, language: string): Promise<Result<RawParseTree>>;
}
