import type Parser from 'web-tree-sitter';
import type { ClassDNA, FileDNA, FunctionDNA } from '@project-dna/dna-core';
import type { TreeSitterParseTree } from '../parsers/parser.interface.js';
import type { TreeSitterExtraction } from './tree-sitter-extraction.js';
import { createDnaId } from './utils.js';

type Node = Parser.SyntaxNode;
type ImportDNA = FileDNA['imports'][number];
type ExportDNA = FileDNA['exports'][number];
type ParameterDNA = FunctionDNA['parameters'][number];

const DECISION_NODES = [
  'if_statement',
  'if_expression',
  'for_statement',
  'for_expression',
  'while_statement',
  'while_expression',
  'do_statement',
  'catch_clause',
  'match_expression',
  'switch_statement',
  'switch_expression',
  'conditional_expression',
] as const;

export class MultiLanguageExtractor {
  extract(parseTree: TreeSitterParseTree, filePath: string): TreeSitterExtraction {
    const structural = this.extractStructure(parseTree, filePath);
    return {
      ...structural,
      comments: extractComments(parseTree.tree.rootNode),
      complexity: complexity(parseTree.tree.rootNode),
      linesOfCode: countCodeLines(parseTree.content, extractComments(parseTree.tree.rootNode)),
    };
  }

  private extractStructure(
    parseTree: TreeSitterParseTree,
    filePath: string,
  ): Omit<TreeSitterExtraction, 'comments' | 'complexity' | 'linesOfCode'> {
    switch (parseTree.language) {
      case 'go':
        return extractGo(parseTree.tree.rootNode, filePath);
      case 'java':
        return extractJava(parseTree.tree.rootNode, filePath);
      case 'rust':
        return extractRust(parseTree.tree.rootNode, filePath);
      case 'csharp':
        return extractCSharp(parseTree.tree.rootNode, filePath);
      default:
        throw new Error(`No structural extractor registered for ${parseTree.language}`);
    }
  }
}

function extractGo(
  root: Node,
  filePath: string,
): Omit<TreeSitterExtraction, 'comments' | 'complexity' | 'linesOfCode'> {
  const methodsByType = new Map<string, ClassDNA['methods']>();
  for (const method of root.descendantsOfType('method_declaration')) {
    const receiverType = method
      .childForFieldName('receiver')
      ?.descendantsOfType('type_identifier')
      .at(-1)?.text;
    if (!receiverType) continue;
    const methods = methodsByType.get(receiverType) ?? [];
    methods.push(asMethod(extractGoFunction(method, filePath)));
    methodsByType.set(receiverType, methods);
  }

  const classes = root.descendantsOfType('type_spec').flatMap((node) => {
    const type = node.childForFieldName('type');
    if (type?.type !== 'struct_type') return [];
    const name = node.childForFieldName('name')?.text ?? '';
    const properties: ClassDNA['properties'] = type
      .descendantsOfType('field_declaration')
      .flatMap((field) => {
        const names = field.childrenForFieldName('name');
        const fieldType = field.childForFieldName('type')?.text;
        return names.map((fieldName) => ({
          name: fieldName.text,
          ...(fieldType ? { type: fieldType } : {}),
          visibility: goPublic(fieldName.text) ? 'public' as const : 'private' as const,
          isStatic: false,
          isReadonly: false,
          isOptional: false,
          hasDefaultValue: false,
        }));
      });
    return [
      {
        id: createDnaId('class', filePath, name, node.startIndex),
        name,
        filePath,
        ...lineRange(node),
        methods: methodsByType.get(name) ?? [],
        properties,
        decorators: [],
        implements: [],
        isAbstract: false,
        isExported: goPublic(name),
        visibility: goPublic(name) ? 'public' as const : 'private' as const,
      },
    ];
  });
  const functions = root
    .descendantsOfType('function_declaration')
    .map((node) => extractGoFunction(node, filePath));
  const imports = root.descendantsOfType('import_spec').map((node) => {
    const source = stripQuotes(node.childForFieldName('path')?.text ?? '');
    const alias = node.namedChildren.find((child) => child !== node.childForFieldName('path'))?.text;
    return importEntry(source, source.split('/').at(-1) ?? source, alias);
  });
  return {
    classes,
    functions,
    imports,
    exports: [
      ...classes.filter((item) => item.isExported).map((item) => namedExport(item.name)),
      ...functions.filter((item) => item.isExported).map((item) => namedExport(item.name)),
    ],
  };
}

function extractGoFunction(node: Node, filePath: string): FunctionDNA {
  const name = node.childForFieldName('name')?.text ?? '';
  return {
    id: createDnaId('function', filePath, name, node.startIndex),
    name,
    filePath,
    ...lineRange(node),
    parameters: extractGoParameters(node.childForFieldName('parameters')),
    ...(node.childForFieldName('result') ? { returnType: node.childForFieldName('result')?.text } : {}),
    isAsync: false,
    isExported: goPublic(name),
    isGenerator: false,
    isArrow: false,
    complexity: complexity(node),
    decorators: [],
  };
}

function extractGoParameters(parameters: Node | null): ParameterDNA[] {
  return (parameters?.namedChildren ?? []).flatMap((parameter) => {
    if (parameter.type !== 'parameter_declaration' && parameter.type !== 'variadic_parameter_declaration') {
      return [];
    }
    const type = parameter.childForFieldName('type')?.text;
    const names = parameter.childrenForFieldName('name');
    return names.map((name) => ({
      name: name.text,
      ...(type ? { type } : {}),
      isOptional: false,
      isRest: parameter.type === 'variadic_parameter_declaration',
    }));
  });
}

function extractJava(
  root: Node,
  filePath: string,
): Omit<TreeSitterExtraction, 'comments' | 'complexity' | 'linesOfCode'> {
  const declarations = root.descendantsOfType(['class_declaration', 'interface_declaration']);
  const classes = declarations.map((node) => {
    const name = node.childForFieldName('name')?.text ?? '';
    const body = node.childForFieldName('body');
    const methods = (body?.namedChildren ?? [])
      .filter((child) => child.type === 'method_declaration' || child.type === 'constructor_declaration')
      .map((method) => asMethod(extractJavaFunction(method, filePath)));
    const properties: ClassDNA['properties'] = (body?.namedChildren ?? [])
      .filter((child) => child.type === 'field_declaration')
      .flatMap((field) => {
        const fieldType = field.childForFieldName('type')?.text;
        const visibility = javaVisibility(field);
        return field.descendantsOfType('variable_declarator').map((declarator) => ({
          name: declarator.childForFieldName('name')?.text ?? '',
          ...(fieldType ? { type: fieldType } : {}),
          visibility,
          isStatic: hasModifier(field, 'static'),
          isReadonly: hasModifier(field, 'final'),
          isOptional: false,
          hasDefaultValue: declarator.childForFieldName('value') !== null,
        }));
      });
    const superClass = node.childForFieldName('superclass')?.namedChildren[0]?.text;
    const implementsTypes = node
      .childForFieldName('interfaces')
      ?.descendantsOfType('type_identifier')
      .map((item) => item.text) ?? [];
    const visibility = classVisibility(node);
    return {
      id: createDnaId('class', filePath, name, node.startIndex),
      name,
      filePath,
      ...lineRange(node),
      methods,
      properties,
      decorators: node.childrenForFieldName('annotation').map((item) => item.text),
      implements: implementsTypes,
      ...(superClass ? { extends: superClass } : {}),
      isAbstract: node.type === 'interface_declaration' || hasModifier(node, 'abstract'),
      isExported: hasModifier(node, 'public'),
      visibility,
    } satisfies ClassDNA;
  });
  const imports = root.descendantsOfType('import_declaration').map((node) => {
    const source = node.text.replace(/^import\s+(?:static\s+)?/u, '').replace(/;$/u, '').trim();
    return importEntry(source, source.split('.').at(-1) ?? source);
  });
  return {
    classes,
    functions: [],
    imports,
    exports: classes.filter((item) => item.isExported).map((item) => namedExport(item.name)),
  };
}

function extractJavaFunction(node: Node, filePath: string): FunctionDNA {
  const name = node.childForFieldName('name')?.text ?? '';
  const parameters = node.childForFieldName('parameters');
  return {
    id: createDnaId('function', filePath, name, node.startIndex),
    name,
    filePath,
    ...lineRange(node),
    parameters: (parameters?.namedChildren ?? [])
      .filter((item) => item.type === 'formal_parameter' || item.type === 'spread_parameter')
      .map((item) => parameterFromFields(item, item.type === 'spread_parameter')),
    ...(node.childForFieldName('type') ? { returnType: node.childForFieldName('type')?.text } : {}),
    isAsync: false,
    isExported: hasModifier(node, 'public'),
    isGenerator: false,
    isArrow: false,
    complexity: complexity(node),
    decorators: [],
  };
}

function extractRust(
  root: Node,
  filePath: string,
): Omit<TreeSitterExtraction, 'comments' | 'complexity' | 'linesOfCode'> {
  const methodsByType = new Map<string, ClassDNA['methods']>();
  for (const implementation of root.descendantsOfType('impl_item')) {
    const typeName = implementation.childForFieldName('type')?.text;
    if (!typeName) continue;
    const methods = implementation
      .childForFieldName('body')
      ?.namedChildren.filter((item) => item.type === 'function_item')
      .map((item) => asMethod(extractRustFunction(item, filePath), true)) ?? [];
    methodsByType.set(typeName, methods);
  }
  const classes = root.descendantsOfType('struct_item').map((node) => {
    const name = node.childForFieldName('name')?.text ?? '';
    const properties: ClassDNA['properties'] = (node.childForFieldName('body')?.namedChildren ?? [])
      .filter((item) => item.type === 'field_declaration')
      .map((field) => ({
        name: field.childForFieldName('name')?.text ?? '',
        ...(field.childForFieldName('type') ? { type: field.childForFieldName('type')?.text } : {}),
        visibility: hasChildType(field, 'visibility_modifier') ? 'public' as const : 'private' as const,
        isStatic: false,
        isReadonly: false,
        isOptional: false,
        hasDefaultValue: false,
      }));
    const exported = hasChildType(node, 'visibility_modifier');
    return {
      id: createDnaId('class', filePath, name, node.startIndex),
      name,
      filePath,
      ...lineRange(node),
      methods: methodsByType.get(name) ?? [],
      properties,
      decorators: [],
      implements: [],
      isAbstract: false,
      isExported: exported,
      visibility: exported ? 'public' as const : 'private' as const,
    };
  });
  const functions = root
    .descendantsOfType('function_item')
    .filter((node) => !hasAncestor(node, 'impl_item'))
    .map((node) => extractRustFunction(node, filePath));
  const imports = root.descendantsOfType('use_declaration').map((node) => {
    const source = node.childForFieldName('argument')?.text ?? '';
    return importEntry(source, source.split('::').at(-1) ?? source);
  });
  return {
    classes,
    functions,
    imports,
    exports: [
      ...classes.filter((item) => item.isExported).map((item) => namedExport(item.name)),
      ...functions.filter((item) => item.isExported).map((item) => namedExport(item.name)),
    ],
  };
}

function extractRustFunction(node: Node, filePath: string): FunctionDNA {
  const name = node.childForFieldName('name')?.text ?? '';
  return {
    id: createDnaId('function', filePath, name, node.startIndex),
    name,
    filePath,
    ...lineRange(node),
    parameters: (node.childForFieldName('parameters')?.namedChildren ?? []).map((item) => {
      if (item.type === 'self_parameter') {
        return { name: 'self', type: item.text, isOptional: false, isRest: false };
      }
      return parameterFromFields(item, false, 'pattern');
    }),
    ...(node.childForFieldName('return_type') ? { returnType: node.childForFieldName('return_type')?.text } : {}),
    isAsync: hasChildText(node, 'async'),
    isExported: hasChildType(node, 'visibility_modifier'),
    isGenerator: node.descendantsOfType('yield_expression').length > 0,
    isArrow: false,
    complexity: complexity(node),
    decorators: [],
  };
}

function extractCSharp(
  root: Node,
  filePath: string,
): Omit<TreeSitterExtraction, 'comments' | 'complexity' | 'linesOfCode'> {
  const classes = root.descendantsOfType(['class_declaration', 'interface_declaration']).map((node) => {
    const name = node.childForFieldName('name')?.text ?? '';
    const body = node.childForFieldName('body');
    const methods = (body?.namedChildren ?? [])
      .filter((item) => item.type === 'method_declaration' || item.type === 'constructor_declaration')
      .map((item) => asMethod(extractCSharpFunction(item, filePath)));
    const properties: ClassDNA['properties'] = (body?.namedChildren ?? [])
      .filter((item) => item.type === 'field_declaration')
      .flatMap((field) => {
        const declaration = field.namedChildren.find((child) => child.type === 'variable_declaration');
        const type = declaration?.childForFieldName('type')?.text ?? declaration?.namedChildren[0]?.text;
        return (declaration?.descendantsOfType('variable_declarator') ?? []).map((item) => ({
          name: item.childForFieldName('name')?.text ?? item.namedChildren[0]?.text ?? '',
          ...(type ? { type } : {}),
          visibility: csharpVisibility(field),
          isStatic: hasModifier(field, 'static'),
          isReadonly: hasModifier(field, 'readonly'),
          isOptional: false,
          hasDefaultValue: extractDefaultValue(item) !== undefined,
        }));
      });
    const baseTypes = node.childForFieldName('bases')?.namedChildren.map((item) => item.text) ?? [];
    const exported = hasModifier(node, 'public');
    return {
      id: createDnaId('class', filePath, name, node.startIndex),
      name,
      filePath,
      ...lineRange(node),
      methods,
      properties,
      decorators: node.namedChildren.filter((item) => item.type === 'attribute_list').map((item) => item.text),
      implements: node.type === 'interface_declaration' ? [] : baseTypes.slice(1),
      ...(baseTypes[0] ? { extends: baseTypes[0] } : {}),
      isAbstract: node.type === 'interface_declaration' || hasModifier(node, 'abstract'),
      isExported: exported,
      visibility: exported ? 'public' as const : classVisibility(node),
    } satisfies ClassDNA;
  });
  const imports = root.descendantsOfType('using_directive').map((node) => {
    const source = node.text.replace(/^using\s+/u, '').replace(/;$/u, '').trim();
    return importEntry(source, source.split('.').at(-1) ?? source);
  });
  return {
    classes,
    functions: [],
    imports,
    exports: classes.filter((item) => item.isExported).map((item) => namedExport(item.name)),
  };
}

function extractCSharpFunction(node: Node, filePath: string): FunctionDNA {
  const name = node.childForFieldName('name')?.text ?? '';
  return {
    id: createDnaId('function', filePath, name, node.startIndex),
    name,
    filePath,
    ...lineRange(node),
    parameters: (node.childForFieldName('parameters')?.namedChildren ?? [])
      .filter((item) => item.type === 'parameter')
      .map((item) => parameterFromFields(item)),
    ...(node.childForFieldName('type') ? { returnType: node.childForFieldName('type')?.text } : {}),
    isAsync: hasModifier(node, 'async'),
    isExported: hasModifier(node, 'public'),
    isGenerator: node.descendantsOfType('yield_statement').length > 0,
    isArrow: false,
    complexity: complexity(node),
    decorators: [],
  };
}

function parameterFromFields(
  node: Node,
  isRest = false,
  nameField = 'name',
): ParameterDNA {
  const name = node.childForFieldName(nameField)?.text ?? node.namedChildren[0]?.text ?? '';
  const type = node.childForFieldName('type')?.text;
  const defaultValue = extractDefaultValue(node);
  return {
    name,
    ...(type ? { type } : {}),
    isOptional: defaultValue !== undefined,
    isRest,
    ...(defaultValue ? { defaultValue } : {}),
  };
}

function extractDefaultValue(node: Node): string | undefined {
  const value = node.childForFieldName('value')?.text;
  if (value !== undefined) return value;

  const equalsValue = node.namedChildren.find((child) => child.type === 'equals_value_clause');
  return equalsValue?.text.replace(/^=\s*/u, '');
}

function asMethod(functionDna: FunctionDNA, dropSelf = false): ClassDNA['methods'][number] {
  return {
    name: functionDna.name,
    visibility: functionDna.isExported ? 'public' : 'private',
    isStatic: false,
    isAsync: functionDna.isAsync,
    isAbstract: false,
    parameters: functionDna.parameters
      .filter((parameter) => !dropSelf || parameter.name !== 'self')
      .map(({ name, type, isOptional }) => ({ name, ...(type ? { type } : {}), isOptional })),
    ...(functionDna.returnType ? { returnType: functionDna.returnType } : {}),
    startLine: functionDna.startLine,
    endLine: functionDna.endLine,
    complexity: functionDna.complexity,
  };
}

function importEntry(source: string, name: string, alias?: string): ImportDNA {
  return {
    source,
    specifiers: [{ name, ...(alias ? { alias } : {}), isDefault: false, isNamespace: false }],
    isTypeOnly: false,
    isDynamic: false,
  };
}

function namedExport(name: string): ExportDNA {
  return { name, type: 'named', isTypeOnly: false };
}

function extractComments(root: Node): FileDNA['comments'] {
  return root
    .descendantsOfType(['comment', 'line_comment', 'block_comment'])
    .filter((node, index, all) => all.findIndex((candidate) => candidate.id === node.id) === index)
    .map((node) => ({
      text: cleanComment(node.text),
      type: node.text.startsWith('/*') ? 'block' as const : 'line' as const,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
    }));
}

function cleanComment(text: string): string {
  return text
    .replace(/^\/\*+|\*\/$/gu, '')
    .replace(/^\/\/[/!]?\s?/u, '')
    .replace(/^#\s?/u, '')
    .split(/\r?\n/u)
    .map((line) => line.replace(/^\s*\*\s?/u, '').trimEnd())
    .join('\n')
    .trim();
}

function countCodeLines(content: string, comments: FileDNA['comments']): number {
  const commentLines = new Set<number>();
  for (const comment of comments) {
    for (let line = comment.startLine; line <= comment.endLine; line += 1) commentLines.add(line);
  }
  return content
    .split(/\r?\n/u)
    .filter((line, index) => line.trim().length > 0 && !commentLines.has(index + 1)).length;
}

function complexity(node: Node): number {
  return 1 + node.descendantsOfType([...DECISION_NODES]).length;
}

function lineRange(node: Node): { startLine: number; endLine: number } {
  return { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 };
}

function goPublic(name: string): boolean {
  return /^[A-Z]/u.test(name);
}

function hasModifier(node: Node, modifier: string): boolean {
  return node.namedChildren.some(
    (child) =>
      (child.type === 'modifiers' || child.type === 'modifier') &&
      new RegExp(`(?:^|\\s)${modifier}(?:$|\\s)`, 'u').test(child.text),
  );
}

function hasChildType(node: Node, type: string): boolean {
  return node.namedChildren.some((child) => child.type === type);
}

function hasChildText(node: Node, text: string): boolean {
  return node.children.some((child) => child.text === text);
}

function hasAncestor(node: Node, type: string): boolean {
  let current = node.parent;
  while (current) {
    if (current.type === type) return true;
    current = current.parent;
  }
  return false;
}

function javaVisibility(node: Node): 'public' | 'protected' | 'private' {
  if (hasModifier(node, 'private')) return 'private';
  if (hasModifier(node, 'protected')) return 'protected';
  return 'public';
}

function csharpVisibility(node: Node): 'public' | 'protected' | 'private' {
  if (hasModifier(node, 'private')) return 'private';
  if (hasModifier(node, 'protected')) return 'protected';
  return 'public';
}

function classVisibility(node: Node): ClassDNA['visibility'] {
  if (hasModifier(node, 'private')) return 'private';
  if (hasModifier(node, 'protected')) return 'protected';
  if (hasModifier(node, 'public')) return 'public';
  return 'default';
}

function stripQuotes(text: string): string {
  return text.replace(/^['"]|['"]$/gu, '');
}
