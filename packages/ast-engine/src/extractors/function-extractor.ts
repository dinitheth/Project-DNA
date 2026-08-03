/** Extracts top-level function declarations and function-valued variables. */

import { Node } from 'ts-morph';
import type { FunctionDNA } from '@project-dna/dna-core';
import type { IExtractor } from './extractor.interface.js';
import type { TypeScriptParseTree } from '../parsers/parser.interface.js';
import {
  calculateComplexity,
  createDnaId,
  getLineRange,
  getParameterData,
  readJsDocDescription,
} from './utils.js';

export class FunctionExtractor implements IExtractor<FunctionDNA, TypeScriptParseTree> {
  public extract(parseTree: TypeScriptParseTree, filePath: string): FunctionDNA[] {
    const declarations = parseTree.sourceFile.getFunctions().map((declaration) => {
      const name = declaration.getName() ?? '';
      return {
        id: createDnaId('function', filePath, name, declaration.getStart()),
        name,
        filePath,
        ...getLineRange(declaration),
        parameters: declaration.getParameters().map(getParameterData),
        ...(declaration.getReturnTypeNode()
          ? { returnType: declaration.getReturnTypeNode()?.getText() }
          : {}),
        isAsync: declaration.isAsync(),
        isExported: declaration.isExported() || declaration.isDefaultExport(),
        isGenerator: declaration.isGenerator(),
        isArrow: false,
        complexity: calculateComplexity(declaration),
        decorators: [],
        ...(readJsDocDescription(declaration)
          ? { docComment: readJsDocDescription(declaration) }
          : {}),
      } satisfies FunctionDNA;
    });

    const variables = parseTree.sourceFile.getVariableDeclarations().flatMap((variable) => {
      const initializer = variable.getInitializer();
      if (
        !initializer ||
        (!Node.isArrowFunction(initializer) && !Node.isFunctionExpression(initializer))
      ) {
        return [];
      }

      const statement = variable.getVariableStatement();
      const name = variable.getName();
      return [
        {
          id: createDnaId('function', filePath, name, variable.getStart()),
          name,
          filePath,
          ...getLineRange(initializer),
          parameters: initializer.getParameters().map(getParameterData),
          ...(initializer.getReturnTypeNode()
            ? { returnType: initializer.getReturnTypeNode()?.getText() }
            : {}),
          isAsync: initializer.isAsync(),
          isExported: statement?.isExported() ?? false,
          isGenerator: Node.isFunctionExpression(initializer) && initializer.isGenerator(),
          isArrow: Node.isArrowFunction(initializer),
          complexity: calculateComplexity(initializer),
          decorators: [],
        } satisfies FunctionDNA,
      ];
    });

    return [...declarations, ...variables].sort((left, right) => left.startLine - right.startLine);
  }
}
