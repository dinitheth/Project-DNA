/** Extracts line, block, and documentation comments from source text. */

import type { IExtractor } from './extractor.interface.js';
import type { RawParseTree } from '../parsers/parser.interface.js';
import type { CommentDNA } from './types.js';
import { ts } from 'ts-morph';

export class CommentExtractor implements IExtractor<CommentDNA> {
  public extract(parseTree: RawParseTree): CommentDNA[] {
    const comments: CommentDNA[] = [];
    const scanner = ts.createScanner(
      ts.ScriptTarget.ES2022,
      false,
      ts.LanguageVariant.Standard,
      parseTree.content,
    );
    let token = scanner.scan();

    while (token !== ts.SyntaxKind.EndOfFileToken) {
      if (
        token === ts.SyntaxKind.SingleLineCommentTrivia ||
        token === ts.SyntaxKind.MultiLineCommentTrivia
      ) {
        const text = scanner.getTokenText();
        const startLine = lineAt(parseTree.content, scanner.getTokenPos());
        comments.push({
          text: cleanComment(text),
          type:
            token === ts.SyntaxKind.SingleLineCommentTrivia
              ? 'line'
              : text.startsWith('/**')
                ? 'doc'
                : 'block',
          startLine,
          endLine: startLine + countNewlines(text),
        });
      }
      token = scanner.scan();
    }
    return comments;
  }
}

function lineAt(content: string, offset: number): number {
  return content.slice(0, offset).split(/\r?\n/u).length;
}

function countNewlines(content: string): number {
  return content.split(/\r?\n/u).length - 1;
}

function cleanComment(comment: string): string {
  return comment
    .replace(/^\/\*\*?/u, '')
    .replace(/\*\/$/u, '')
    .replace(/^\/\//u, '')
    .split(/\r?\n/u)
    .map((line) => line.replace(/^\s*\* ?/u, '').trimEnd())
    .join('\n')
    .trim();
}
