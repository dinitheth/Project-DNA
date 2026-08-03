/**
 * @module tree-sitter-parser
 * @description Tree-sitter based implementation of the parser.
 */

import type { IParser, RawParseTree } from './parser.interface.js';
import Parser from 'web-tree-sitter';
import { Err, Ok, type Result } from '@project-dna/shared';

const WASM_BY_LANGUAGE: Readonly<Record<string, string>> = {
  python: 'tree-sitter-wasms/out/tree-sitter-python.wasm',
};

let initialization: Promise<void> | null = null;
const languages = new Map<string, Promise<Parser.Language>>();

export class TreeSitterParser implements IParser {
  public getSupportedLanguages(): string[] {
    return Object.keys(WASM_BY_LANGUAGE);
  }

  public async parse(
    content: string,
    language: string,
    _filePath?: string,
  ): Promise<Result<RawParseTree>> {
    const grammarPath = WASM_BY_LANGUAGE[language];
    if (!grammarPath) return Err(new Error(`Unsupported Tree-sitter language: ${language}`));

    try {
      await initializeParser();
      const parser = new Parser();
      try {
        parser.setLanguage(await loadLanguage(language, grammarPath));
        const tree = parser.parse(content);
        return Ok({ kind: 'tree-sitter', tree, content, language });
      } finally {
        parser.delete();
      }
    } catch (error) {
      return Err(error instanceof Error ? error : new Error(String(error)));
    }
  }
}

async function initializeParser(): Promise<void> {
  initialization ??= Parser.init({
    locateFile: () => require.resolve('web-tree-sitter/tree-sitter.wasm'),
  });
  return initialization;
}

function loadLanguage(language: string, grammarPath: string): Promise<Parser.Language> {
  let loaded = languages.get(language);
  if (!loaded) {
    loaded = Parser.Language.load(require.resolve(grammarPath));
    languages.set(language, loaded);
  }
  return loaded;
}
