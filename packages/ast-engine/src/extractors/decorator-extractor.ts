/** Extracts decorator applications for future enrichment stages. */

import { Node } from 'ts-morph';
import type { IExtractor } from './extractor.interface.js';
import type { TypeScriptParseTree } from '../parsers/parser.interface.js';
import type { DecoratorDNA } from './types.js';

export class DecoratorExtractor implements IExtractor<DecoratorDNA, TypeScriptParseTree> {
  public extract(parseTree: TypeScriptParseTree): DecoratorDNA[] {
    return parseTree.sourceFile.getDescendants().flatMap((node) => {
      if (!Node.isDecorator(node)) return [];
      const target = node.getParent();
      return [
        {
          name: node.getName(),
          expression: node.getExpression().getText(),
          targetKind: target.getKindName(),
          targetName:
            'getName' in target && typeof target.getName === 'function'
              ? (target.getName() ?? '')
              : '',
        },
      ];
    });
  }
}
