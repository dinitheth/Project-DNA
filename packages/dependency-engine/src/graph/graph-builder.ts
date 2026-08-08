/** Builds repository dependency graphs from parsed FileDNA imports and re-exports. */

import path from 'node:path';
import {
  RepositoryGraph,
  type FileDNA,
  type IncrementalDependencyRequest,
} from '@project-dna/dna-core';
import { Err, Ok, type Logger, type Result } from '@project-dna/shared';

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'] as const;

export class GraphBuilder {
  constructor(private readonly logger?: Logger) {}

  public build(files: FileDNA[], rootPath: string, signal?: AbortSignal): Result<RepositoryGraph> {
    return this.buildForSources(files, rootPath, null, signal);
  }

  public repair(
    request: IncrementalDependencyRequest,
    signal?: AbortSignal,
  ): Result<RepositoryGraph> {
    const previousPaths = normalizedPathSet(request.previousFiles, request.rootPath);
    const currentPaths = normalizedPathSet(request.files, request.rootPath);
    const structureChanged = !setsEqual(previousPaths, currentPaths);
    const dirtySources = structureChanged
      ? currentPaths
      : new Set(
          request.changedPaths
            .map((filePath) => normalizeFilePath(filePath, request.rootPath))
            .filter((filePath) => currentPaths.has(filePath)),
        );
    const candidate = this.buildForSources(request.files, request.rootPath, dirtySources, signal);
    if (!candidate.ok) return candidate;

    if (structureChanged) return candidate;
    for (const sourcePath of [...currentPaths].sort()) {
      if (dirtySources.has(sourcePath)) continue;
      request.previousGraph.forEachOutEdge(sourcePath, (_edgeId, attributes, _source, target) => {
        const targetAttributes = request.previousGraph.getNodeAttributes(target);
        if (targetAttributes?.kind === 'external') {
          candidate.value.addExternalNode(target, targetAttributes.label);
        }
        if (targetAttributes?.kind === 'file' && !currentPaths.has(target)) return;
        candidate.value.addDependency(sourcePath, target, { ...attributes });
      });
    }
    return candidate;
  }

  private buildForSources(
    files: FileDNA[],
    rootPath: string,
    sourcePaths: ReadonlySet<string> | null,
    signal?: AbortSignal,
  ): Result<RepositoryGraph> {
    const graph = new RepositoryGraph();
    const normalizedFiles = new Map<string, FileDNA>();

    for (const file of filesInPathOrder(files)) {
      if (signal?.aborted) return Err(new Error('Dependency analysis cancelled'));
      const normalizedPath = normalizeFilePath(file.path, rootPath);
      normalizedFiles.set(normalizedPath, file);
      graph.addFileNode(normalizedPath, {
        label: path.posix.basename(normalizedPath),
        path: normalizedPath,
        language: file.language,
        complexity: file.complexity,
        linesOfCode: file.linesOfCode,
      });
    }

    const knownPaths = new Set(normalizedFiles.keys());
    for (const [sourcePath, file] of normalizedFiles) {
      if (signal?.aborted) return Err(new Error('Dependency analysis cancelled'));
      if (sourcePaths && !sourcePaths.has(sourcePath)) continue;

      for (const imported of file.imports) {
        const resolution = resolveSpecifier(sourcePath, imported.source, knownPaths);
        if (resolution.kind === 'internal') {
          graph.addDependency(sourcePath, resolution.target, {
            type: imported.isDynamic
              ? 'dynamic-import'
              : imported.isTypeOnly
                ? 'type-import'
                : 'import',
            isTypeOnly: imported.isTypeOnly,
            specifierCount: imported.specifiers.length,
            isExternal: false,
          });
        } else if (resolution.kind === 'external') {
          const externalId = `external:${resolution.packageName}`;
          graph.addExternalNode(externalId, resolution.packageName);
          graph.addDependency(sourcePath, externalId, {
            type: imported.isDynamic
              ? 'dynamic-import'
              : imported.isTypeOnly
                ? 'type-import'
                : 'import',
            isTypeOnly: imported.isTypeOnly,
            specifierCount: imported.specifiers.length,
            isExternal: true,
          });
        } else {
          this.logger?.debug(`Unresolved internal import ${imported.source} from ${sourcePath}`);
        }
      }

      for (const exported of file.exports) {
        if (!exported.source) continue;
        const resolution = resolveSpecifier(sourcePath, exported.source, knownPaths);
        if (resolution.kind === 'internal') {
          graph.addDependency(sourcePath, resolution.target, {
            type: 're-export',
            isTypeOnly: exported.isTypeOnly,
            specifierCount: exported.name === '*' ? 0 : 1,
            isExternal: false,
          });
        } else if (resolution.kind === 'external') {
          const externalId = `external:${resolution.packageName}`;
          graph.addExternalNode(externalId, resolution.packageName);
          graph.addDependency(sourcePath, externalId, {
            type: 're-export',
            isTypeOnly: exported.isTypeOnly,
            specifierCount: exported.name === '*' ? 0 : 1,
            isExternal: true,
          });
        }
      }
    }

    return Ok(graph);
  }
}

function filesInPathOrder(files: FileDNA[]): FileDNA[] {
  for (let index = 1; index < files.length; index++) {
    if (files[index - 1]!.path.localeCompare(files[index]!.path) > 0) {
      return [...files].sort((left, right) => left.path.localeCompare(right.path));
    }
  }
  return files;
}

function normalizedPathSet(files: readonly FileDNA[], rootPath: string): Set<string> {
  return new Set(files.map((file) => normalizeFilePath(file.path, rootPath)));
}

function setsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

type Resolution =
  | { readonly kind: 'internal'; readonly target: string }
  | { readonly kind: 'external'; readonly packageName: string }
  | { readonly kind: 'unresolved' };

function resolveSpecifier(
  sourcePath: string,
  specifier: string,
  knownPaths: Set<string>,
): Resolution {
  if (isRelativeSpecifier(specifier)) {
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), specifier));
    const target = findKnownFile(base, knownPaths);
    return target ? { kind: 'internal', target } : { kind: 'unresolved' };
  }

  for (const aliasCandidate of aliasCandidates(specifier)) {
    const target = findKnownFile(aliasCandidate, knownPaths);
    if (target) return { kind: 'internal', target };
  }

  const workspaceTarget = resolveWorkspacePackage(specifier, knownPaths);
  if (workspaceTarget) return { kind: 'internal', target: workspaceTarget };

  return { kind: 'external', packageName: packageRoot(specifier) };
}

function findKnownFile(base: string, knownPaths: Set<string>): string | null {
  const normalizedBase = normalizePath(base).replace(/^\.\//u, '');
  const candidates = new Set<string>([normalizedBase]);
  const extension = path.posix.extname(normalizedBase);

  if (extension) {
    const withoutExtension = normalizedBase.slice(0, -extension.length);
    for (const sourceExtension of SOURCE_EXTENSIONS)
      candidates.add(`${withoutExtension}${sourceExtension}`);
  } else {
    for (const sourceExtension of SOURCE_EXTENSIONS) {
      candidates.add(`${normalizedBase}${sourceExtension}`);
      candidates.add(`${normalizedBase}/index${sourceExtension}`);
    }
  }

  for (const candidate of candidates) {
    if (knownPaths.has(candidate)) return candidate;
  }
  return null;
}

function aliasCandidates(specifier: string): string[] {
  if (specifier.startsWith('@/') || specifier.startsWith('~/')) {
    const suffix = specifier.slice(2);
    return [`src/${suffix}`, suffix];
  }
  if (specifier.startsWith('/')) return [specifier.slice(1)];
  return [];
}

function resolveWorkspacePackage(specifier: string, knownPaths: Set<string>): string | null {
  const parts = specifier.split('/');
  const packageName = specifier.startsWith('@') ? parts[1] : parts[0];
  if (!packageName) return null;
  const subpath = specifier.startsWith('@') ? parts.slice(2).join('/') : parts.slice(1).join('/');

  for (const root of [`packages/${packageName}`, `apps/${packageName}`]) {
    const bases = subpath
      ? [`${root}/${subpath}`, `${root}/src/${subpath}`]
      : [`${root}/src/index`, `${root}/index`];
    for (const base of bases) {
      const target = findKnownFile(base, knownPaths);
      if (target) return target;
    }
  }
  return null;
}

function packageRoot(specifier: string): string {
  if (specifier.startsWith('node:')) return specifier;
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? specifier);
}

function normalizeFilePath(filePath: string, rootPath: string): string {
  const normalized = normalizePath(filePath);
  const normalizedRoot = normalizePath(rootPath).replace(/\/$/u, '');
  if (
    path.isAbsolute(filePath) &&
    normalized.toLowerCase().startsWith(`${normalizedRoot.toLowerCase()}/`)
  ) {
    return normalized.slice(normalizedRoot.length + 1);
  }
  return normalized.replace(/^\.\//u, '');
}

function normalizePath(value: string): string {
  return value.replace(/\\/gu, '/');
}

function isRelativeSpecifier(specifier: string): boolean {
  return (
    specifier === '.' ||
    specifier === '..' ||
    specifier.startsWith('./') ||
    specifier.startsWith('../')
  );
}
