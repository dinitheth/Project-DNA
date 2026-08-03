/** Extracts static and dynamic imports. */

import { Node, SyntaxKind } from 'ts-morph';
import type { IExtractor } from './extractor.interface.js';
import type { RawParseTree } from '../parsers/parser.interface.js';
import type { ImportDNA } from './types.js';

export class ImportExtractor implements IExtractor<ImportDNA> {
  public extract(parseTree: RawParseTree): ImportDNA[] {
    const staticImports = parseTree.sourceFile.getImportDeclarations().map((declaration) => {
      const defaultImport = declaration.getDefaultImport();
      const namespaceImport = declaration.getNamespaceImport();
      return {
        source: declaration.getModuleSpecifierValue(),
        specifiers: [
          ...(defaultImport
            ? [
                {
                  name: 'default',
                  alias: defaultImport.getText(),
                  isDefault: true,
                  isNamespace: false,
                },
              ]
            : []),
          ...(namespaceImport
            ? [
                {
                  name: namespaceImport.getText(),
                  isDefault: false,
                  isNamespace: true,
                },
              ]
            : []),
          ...declaration.getNamedImports().map((namedImport) => ({
            name: namedImport.getName(),
            ...(namedImport.getAliasNode() ? { alias: namedImport.getAliasNode()?.getText() } : {}),
            isDefault: false,
            isNamespace: false,
          })),
        ],
        isTypeOnly: declaration.isTypeOnly(),
        isDynamic: false,
      } satisfies ImportDNA;
    });

    const dynamicImports = parseTree.sourceFile
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .flatMap((call) => {
        if (call.getExpression().getKind() !== SyntaxKind.ImportKeyword) return [];
        const argument = call.getArguments()[0];
        if (!argument || !Node.isStringLiteral(argument)) return [];
        return [
          {
            source: argument.getLiteralValue(),
            specifiers: [],
            isTypeOnly: false,
            isDynamic: true,
          } satisfies ImportDNA,
        ];
      });

    return [...staticImports, ...dynamicImports];
  }
}
