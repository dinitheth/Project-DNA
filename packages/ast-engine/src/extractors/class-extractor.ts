/** Extracts class declarations from ts-morph source files. */

import type { ClassDNA } from '@project-dna/dna-core';
import type { IExtractor } from './extractor.interface.js';
import type { RawParseTree } from '../parsers/parser.interface.js';
import { calculateComplexity, createDnaId, getLineRange } from './utils.js';

export class ClassExtractor implements IExtractor<ClassDNA> {
  public extract(parseTree: RawParseTree, filePath: string): ClassDNA[] {
    return parseTree.sourceFile.getClasses().map((classDeclaration) => {
      const name = classDeclaration.getName() ?? 'default';
      const range = getLineRange(classDeclaration);

      return {
        id: createDnaId('class', filePath, name, classDeclaration.getStart()),
        name,
        filePath,
        ...range,
        methods: classDeclaration.getMethods().map((method) => ({
          name: method.getName(),
          visibility: method.getScope() ?? 'public',
          isStatic: method.isStatic(),
          isAsync: method.isAsync(),
          isAbstract: method.isAbstract(),
          parameters: method.getParameters().map((parameter) => ({
            name: parameter.getName(),
            ...(parameter.getTypeNode() ? { type: parameter.getTypeNode()?.getText() } : {}),
            isOptional: parameter.isOptional(),
          })),
          ...(method.getReturnTypeNode()
            ? { returnType: method.getReturnTypeNode()?.getText() }
            : {}),
          ...getLineRange(method),
          complexity: calculateComplexity(method),
        })),
        properties: classDeclaration.getProperties().map((property) => ({
          name: property.getName(),
          ...(property.getTypeNode() ? { type: property.getTypeNode()?.getText() } : {}),
          visibility: property.getScope() ?? 'public',
          isStatic: property.isStatic(),
          isReadonly: property.isReadonly(),
          isOptional: property.hasQuestionToken(),
          hasDefaultValue: property.getInitializer() !== undefined,
        })),
        decorators: classDeclaration.getDecorators().map((decorator) => decorator.getName()),
        implements: classDeclaration.getImplements().map((item) => item.getExpression().getText()),
        ...(classDeclaration.getExtends()
          ? { extends: classDeclaration.getExtends()?.getExpression().getText() }
          : {}),
        isAbstract: classDeclaration.isAbstract(),
        isExported: classDeclaration.isExported() || classDeclaration.isDefaultExport(),
        visibility: classDeclaration.isDefaultExport() ? 'default' : 'public',
      };
    });
  }
}
