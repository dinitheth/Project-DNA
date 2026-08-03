/**
 * @module extractor.interface
 * @description Internal interface for extracting specific structural elements from a raw parse tree.
 */

import type { RawParseTree } from '../parsers/parser.interface.js';

export interface IExtractor<T> {
  /**
   * Extracts specific elements of type T from the raw parse tree.
   * @param parseTree The raw parse tree to extract from.
   * @param filePath The path to the file being parsed.
   */
  extract(parseTree: RawParseTree, filePath: string): T[];
}
