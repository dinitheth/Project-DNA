import type { ClassDNA, FileDNA, FunctionDNA } from '@project-dna/dna-core';
import type { TreeSitterParseTree } from '../parsers/parser.interface.js';
import { createDnaId } from './utils.js';
import type { TreeSitterExtraction } from './tree-sitter-extraction.js';

type ImportDNA = FileDNA['imports'][number];
type ExportDNA = FileDNA['exports'][number];
type CommentDNA = FileDNA['comments'][number];

export class PythonExtractor {
  extract(parseTree: TreeSitterParseTree, filePath: string): TreeSitterExtraction {
    const root = parseTree.tree.rootNode;
    const classes: ClassDNA[] = [];
    const functions: FunctionDNA[] = [];
    const imports: ImportDNA[] = [];
    const exports: ExportDNA[] = [];
    const comments: CommentDNA[] = [];

    for (const node of root.namedChildren) {
      if (node.type === 'import_statement') imports.push(...extractImport(node));
      if (node.type === 'import_from_statement') imports.push(...extractFromImport(node));
      if (node.type === 'comment') comments.push(extractComment(node));

      const definition = unwrapDefinition(node);
      if (!definition) continue;
      if (definition.type === 'class_definition') {
        classes.push(extractClass(definition, filePath, decorators(node)));
        exports.push(...namedExport(definition.childForFieldName('name')));
      } else if (definition.type === 'function_definition') {
        functions.push(extractFunction(definition, filePath, decorators(node)));
        exports.push(...namedExport(definition.childForFieldName('name')));
      }
    }

    for (const node of root.namedChildren) {
      if (node.type !== 'expression_statement') continue;
      const assignment = node.namedChildren[0];
      if (assignment?.type !== 'assignment') continue;
      const name = assignment.childForFieldName('left');
      if (name && isPublicName(name.text)) exports.push(...namedExport(name));
    }

    return {
      classes,
      functions,
      imports,
      exports: uniqueExports(exports),
      comments: [...comments, ...root.descendantsOfType('comment').filter((node) => node.parent?.type !== 'module').map(extractComment)],
      complexity: complexity(root),
      linesOfCode: countCodeLines(parseTree.content),
    };
  }
}

function unwrapDefinition(node: ParserNode): ParserNode | null {
  if (node.type === 'class_definition' || node.type === 'function_definition') return node;
  if (node.type !== 'decorated_definition') return null;
  return node.childForFieldName('definition');
}

function decorators(node: ParserNode): string[] {
  return node.type === 'decorated_definition'
    ? node.namedChildren.filter((child) => child.type === 'decorator').map((child) => child.text.slice(1).trim())
    : [];
}

function extractClass(node: ParserNode, filePath: string, classDecorators: string[]): ClassDNA {
  const name = node.childForFieldName('name')?.text ?? 'default';
  const body = node.childForFieldName('body');
  const methods: ClassDNA['methods'] = [];
  const properties: ClassDNA['properties'] = [];
  for (const child of body?.namedChildren ?? []) {
    const definition = unwrapDefinition(child);
    if (definition?.type === 'function_definition') {
      const parsed = extractFunction(definition, filePath, decorators(child));
      methods.push({
        name: parsed.name,
        visibility: visibility(parsed.name),
        isStatic: false,
        isAsync: parsed.isAsync,
        isAbstract: false,
        parameters: parsed.parameters.map(({ name: parameterName, type, isOptional }) => ({
          name: parameterName,
          ...(type ? { type } : {}),
          isOptional,
        })),
        ...(parsed.returnType ? { returnType: parsed.returnType } : {}),
        startLine: parsed.startLine,
        endLine: parsed.endLine,
        complexity: parsed.complexity,
      });
      continue;
    }
    const assignment = child.type === 'expression_statement' ? child.namedChildren[0] : child;
    if (assignment?.type !== 'assignment') continue;
    const property = assignment.childForFieldName('left');
    if (!property) continue;
    properties.push({
      name: property.text,
      ...(assignment.childForFieldName('type') ? { type: assignment.childForFieldName('type')?.text } : {}),
      visibility: visibility(property.text),
      isStatic: false,
      isReadonly: false,
      isOptional: false,
      hasDefaultValue: assignment.childForFieldName('right') !== null,
    });
  }

  return {
    id: createDnaId('class', filePath, name, node.startIndex),
    name,
    filePath,
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    methods,
    properties,
    decorators: classDecorators,
    implements: [],
    ...(node.childForFieldName('superclasses')?.namedChildren[0]
      ? { extends: node.childForFieldName('superclasses')?.namedChildren[0]?.text }
      : {}),
    isAbstract: false,
    isExported: isPublicName(name),
    visibility: visibility(name) === 'private' ? 'private' : 'public',
  };
}

function extractFunction(node: ParserNode, filePath: string, functionDecorators: string[]): FunctionDNA {
  const name = node.childForFieldName('name')?.text ?? '';
  const body = node.childForFieldName('body');
  const docComment = body?.namedChildren[0]?.type === 'expression_statement' && body.namedChildren[0].namedChildren[0]?.type === 'string'
    ? body.namedChildren[0].namedChildren[0]?.text.replace(/^['"]|['"]$/gu, '').trim()
    : undefined;
  return {
    id: createDnaId('function', filePath, name, node.startIndex),
    name,
    filePath,
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    parameters: (node.childForFieldName('parameters')?.namedChildren ?? []).map(parameter),
    ...(node.childForFieldName('return_type') ? { returnType: node.childForFieldName('return_type')?.text } : {}),
    isAsync: node.text.trimStart().startsWith('async '),
    isExported: isPublicName(name),
    isGenerator: node.descendantsOfType('yield').length > 0,
    isArrow: false,
    complexity: complexity(node),
    decorators: functionDecorators,
    ...(docComment ? { docComment } : {}),
  };
}

function parameter(node: ParserNode): FunctionDNA['parameters'][number] {
  const nameNode = node.namedChildren[0];
  const typeNode = node.childForFieldName('type');
  const defaultNode = node.childForFieldName('value');
  const isRest = node.type === 'list_splat_pattern' || node.type === 'dictionary_splat_pattern';
  return {
    name: nameNode?.text ?? node.text,
    ...(typeNode ? { type: typeNode.text } : {}),
    isOptional: defaultNode !== null || node.type === 'default_parameter' || node.type === 'typed_default_parameter',
    isRest,
    ...(defaultNode ? { defaultValue: defaultNode.text } : {}),
  };
}

function extractImport(node: ParserNode): ImportDNA[] {
  return node.namedChildren.map((child) => {
    const source = child.type === 'aliased_import' ? child.childForFieldName('name')?.text ?? child.text : child.text;
    const alias = child.type === 'aliased_import' ? child.childForFieldName('alias')?.text : undefined;
    return {
      source,
      specifiers: [{ name: source.split('.').at(-1) ?? source, ...(alias ? { alias } : {}), isDefault: false, isNamespace: false }],
      isTypeOnly: false,
      isDynamic: false,
    };
  });
}

function extractFromImport(node: ParserNode): ImportDNA[] {
  const source = node.childForFieldName('module_name')?.text ?? '';
  const specifiers = node.namedChildren
    .filter((child) => child !== node.childForFieldName('module_name'))
    .map((child) => ({
      name: child.type === 'aliased_import' ? child.childForFieldName('name')?.text ?? child.text : child.text,
      ...(child.type === 'aliased_import' && child.childForFieldName('alias') ? { alias: child.childForFieldName('alias')?.text } : {}),
      isDefault: false,
      isNamespace: false,
    }));
  return [{ source, specifiers, isTypeOnly: false, isDynamic: false }];
}

function extractComment(node: ParserNode): CommentDNA {
  const startLine = node.startPosition.row + 1;
  return { text: node.text.replace(/^#\s?/u, '').trim(), type: 'line', startLine, endLine: node.endPosition.row + 1 };
}

function namedExport(node: ParserNode | null): ExportDNA[] {
  if (!node || !isPublicName(node.text)) return [];
  return [{ name: node.text, type: 'named', isTypeOnly: false }];
}

function uniqueExports(exports: ExportDNA[]): ExportDNA[] {
  return exports.filter((entry, index, all) => all.findIndex((candidate) => candidate.name === entry.name) === index);
}

function visibility(name: string): 'public' | 'protected' | 'private' {
  if (name.startsWith('__') && !name.endsWith('__')) return 'private';
  if (name.startsWith('_')) return 'protected';
  return 'public';
}

function isPublicName(name: string): boolean {
  return name.length > 0 && !name.startsWith('_');
}

function complexity(node: ParserNode): number {
  const decisionNodes = new Set(['if_statement', 'for_statement', 'while_statement', 'try_statement', 'match_statement', 'case_clause', 'conditional_expression']);
  return 1 + node.namedChildren.reduce((total, child) => total + (decisionNodes.has(child.type) ? 1 : 0) + complexity(child) - 1, 0);
}

function countCodeLines(content: string): number {
  return content.split(/\r?\n/u).filter((line) => line.trim().length > 0 && !line.trimStart().startsWith('#')).length;
}

interface ParserNode {
  readonly type: string;
  readonly text: string;
  readonly startIndex: number;
  readonly startPosition: { row: number };
  readonly endPosition: { row: number };
  readonly namedChildren: ParserNode[];
  readonly parent: ParserNode | null;
  childForFieldName(fieldName: string): ParserNode | null;
  descendantsOfType(type: string): ParserNode[];
}
