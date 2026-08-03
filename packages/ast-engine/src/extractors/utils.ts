import { createHash } from 'node:crypto';
import {
  Node,
  SyntaxKind,
  type FunctionDeclaration,
  type MethodDeclaration,
  type Node as MorphNode,
  type ParameterDeclaration,
} from 'ts-morph';
import { ts } from 'ts-morph';

export function createDnaId(kind: string, filePath: string, name: string, start: number): string {
  return createHash('sha256').update(`${kind}:${filePath}:${name}:${start}`).digest('hex');
}

export function getLineRange(node: MorphNode): { startLine: number; endLine: number } {
  return {
    startLine: node.getStartLineNumber(),
    endLine: node.getEndLineNumber(),
  };
}

export function getParameterData(parameter: ParameterDeclaration): {
  name: string;
  type?: string;
  isOptional: boolean;
  isRest: boolean;
  defaultValue?: string;
} {
  const typeNode = parameter.getTypeNode();
  const initializer = parameter.getInitializer();
  return {
    name: parameter.getName(),
    ...(typeNode ? { type: typeNode.getText() } : {}),
    isOptional: parameter.isOptional(),
    isRest: parameter.isRestParameter(),
    ...(initializer ? { defaultValue: initializer.getText() } : {}),
  };
}

export function getReturnType(node: FunctionDeclaration | MethodDeclaration): string | undefined {
  return node.getReturnTypeNode()?.getText();
}

export function calculateComplexity(node: MorphNode): number {
  let complexity = 1;
  node.forEachDescendant((descendant) => {
    if (
      Node.isIfStatement(descendant) ||
      Node.isForStatement(descendant) ||
      Node.isForInStatement(descendant) ||
      Node.isForOfStatement(descendant) ||
      Node.isWhileStatement(descendant) ||
      Node.isDoStatement(descendant) ||
      Node.isConditionalExpression(descendant) ||
      Node.isCatchClause(descendant) ||
      descendant.getKind() === SyntaxKind.CaseClause ||
      descendant.getKind() === SyntaxKind.AmpersandAmpersandToken ||
      descendant.getKind() === SyntaxKind.BarBarToken ||
      descendant.getKind() === SyntaxKind.QuestionQuestionToken
    ) {
      complexity += 1;
    }
  });
  return complexity;
}

export function readJsDocDescription(node: FunctionDeclaration): string | undefined {
  const text = node
    .getJsDocs()
    .map((doc) => doc.getDescription().trim())
    .filter(Boolean)
    .join('\n');
  return text || undefined;
}

export function countCodeLines(content: string): number {
  const scanner = ts.createScanner(
    ts.ScriptTarget.ES2022,
    false,
    ts.LanguageVariant.Standard,
    content,
  );
  const lines = new Set<number>();
  let token = scanner.scan();

  while (token !== ts.SyntaxKind.EndOfFileToken) {
    if (
      token !== ts.SyntaxKind.WhitespaceTrivia &&
      token !== ts.SyntaxKind.NewLineTrivia &&
      token !== ts.SyntaxKind.SingleLineCommentTrivia &&
      token !== ts.SyntaxKind.MultiLineCommentTrivia &&
      token !== ts.SyntaxKind.ShebangTrivia
    ) {
      const start = scanner.getTokenPos();
      const end = Math.max(start, scanner.getTextPos() - 1);
      const startLine = lineAt(content, start);
      const endLine = lineAt(content, end);
      for (let line = startLine; line <= endLine; line += 1) lines.add(line);
    }
    token = scanner.scan();
  }

  return lines.size;
}

function lineAt(content: string, offset: number): number {
  return content.slice(0, offset).split(/\r?\n/u).length;
}
