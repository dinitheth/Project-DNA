/** ts-morph parser for TypeScript and JavaScript source files. */

import path from 'node:path';
import { Project, ScriptKind, ts } from 'ts-morph';
import { Err, Ok, type Result } from '@project-dna/shared';
import type { IParser, RawParseTree } from './parser.interface.js';

const SCRIPT_KIND_BY_LANGUAGE: Readonly<Record<string, ScriptKind>> = {
  typescript: ScriptKind.TS,
  typescriptreact: ScriptKind.TSX,
  javascript: ScriptKind.JS,
  javascriptreact: ScriptKind.JSX,
};

export class TypeScriptParser implements IParser {
  public async parse(
    content: string,
    language: string,
    filePath = defaultFileName(language),
  ): Promise<Result<RawParseTree>> {
    try {
      const scriptKind = SCRIPT_KIND_BY_LANGUAGE[language];
      if (scriptKind === undefined) {
        return Err(new Error(`Unsupported TypeScript parser language: ${language}`));
      }

      const project = new Project({
        useInMemoryFileSystem: true,
        skipAddingFilesFromTsConfig: true,
        compilerOptions: {
          allowJs: true,
          allowSyntheticDefaultImports: true,
          target: ts.ScriptTarget.ES2022,
          jsx: ts.JsxEmit.ReactJSX,
        },
      });
      const sourceFile = project.createSourceFile(normalizeVirtualPath(filePath), content, {
        overwrite: true,
        scriptKind,
      });

      return Ok({ kind: 'typescript', sourceFile, content, language });
    } catch (error) {
      return Err(error instanceof Error ? error : new Error(String(error)));
    }
  }
}

function defaultFileName(language: string): string {
  const extension =
    language === 'typescriptreact'
      ? '.tsx'
      : language === 'javascriptreact'
        ? '.jsx'
        : language === 'javascript'
          ? '.js'
          : '.ts';
  return `/source${extension}`;
}

function normalizeVirtualPath(filePath: string): string {
  const normalized = filePath.replace(/\\/gu, '/');
  return normalized.startsWith('/') ? normalized : `/${path.basename(normalized)}`;
}
