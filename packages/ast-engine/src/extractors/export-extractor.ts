/** Extracts explicit exports and exported declarations. */

import type { IExtractor } from './extractor.interface.js';
import type { TypeScriptParseTree } from '../parsers/parser.interface.js';
import type { ExportDNA } from './types.js';

export class ExportExtractor implements IExtractor<ExportDNA, TypeScriptParseTree> {
  public extract(parseTree: TypeScriptParseTree): ExportDNA[] {
    const exports: ExportDNA[] = [];

    for (const declaration of parseTree.sourceFile.getExportDeclarations()) {
      const source = declaration.getModuleSpecifierValue();
      const namedExports = declaration.getNamedExports();
      if (namedExports.length === 0 && source) {
        exports.push({
          name: '*',
          type: 'barrel',
          isTypeOnly: declaration.isTypeOnly(),
          source,
        });
        continue;
      }

      for (const namedExport of namedExports) {
        exports.push({
          name: namedExport.getAliasNode()?.getText() ?? namedExport.getName(),
          type: source ? 're-export' : 'named',
          isTypeOnly: declaration.isTypeOnly() || namedExport.isTypeOnly(),
          ...(source ? { source } : {}),
        });
      }
    }

    for (const declaration of parseTree.sourceFile.getExportAssignments()) {
      exports.push({
        name: declaration.getExpression().getText(),
        type: declaration.isExportEquals() ? 'namespace' : 'default',
        isTypeOnly: false,
      });
    }

    for (const [name, declarations] of parseTree.sourceFile.getExportedDeclarations()) {
      if (exports.some((entry) => entry.name === name)) continue;
      const isDefault = name === 'default';
      exports.push({
        name,
        type: isDefault ? 'default' : 'named',
        isTypeOnly: declarations.every((declaration) =>
          ['InterfaceDeclaration', 'TypeAliasDeclaration'].includes(declaration.getKindName()),
        ),
      });
    }

    return exports;
  }
}
