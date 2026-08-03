/** Summarizes dependencies crossing top-level repository module boundaries. */

import path from 'node:path';
import type { RepositoryGraph } from '@project-dna/dna-core';

export interface ModuleBoundary {
  readonly moduleName: string;
  readonly files: string[];
  readonly internalDependencies: string[];
  readonly externalImports: string[];
  readonly crossModuleImports: string[];
}

export class ModuleBoundaryAnalyzer {
  public analyze(graph: RepositoryGraph): ModuleBoundary[] {
    const modules = new Map<
      string,
      {
        files: Set<string>;
        internalDependencies: Set<string>;
        externalImports: Set<string>;
        crossModuleImports: Set<string>;
      }
    >();

    for (const file of graph.getNodesByKind('file')) {
      const moduleName = getModuleName(file);
      const boundary = getOrCreate(modules, moduleName);
      boundary.files.add(file);

      for (const target of graph.getDependencies(file)) {
        const attributes = graph.getNodeAttributes(target);
        if (attributes?.kind === 'external') {
          boundary.externalImports.add(attributes.label);
        } else if (attributes?.kind === 'file') {
          const targetModule = getModuleName(target);
          if (targetModule === moduleName) boundary.internalDependencies.add(target);
          else boundary.crossModuleImports.add(`${targetModule}:${target}`);
        }
      }
    }

    return Array.from(modules.entries())
      .map(([moduleName, value]) => ({
        moduleName,
        files: sorted(value.files),
        internalDependencies: sorted(value.internalDependencies),
        externalImports: sorted(value.externalImports),
        crossModuleImports: sorted(value.crossModuleImports),
      }))
      .sort((left, right) => left.moduleName.localeCompare(right.moduleName));
  }
}

function getModuleName(filePath: string): string {
  const parts = filePath.split('/');
  if ((parts[0] === 'packages' || parts[0] === 'apps') && parts[1])
    return `${parts[0]}/${parts[1]}`;
  return parts[0] && path.posix.extname(parts[0]) === '' ? parts[0] : 'root';
}

function getOrCreate(
  modules: Map<
    string,
    {
      files: Set<string>;
      internalDependencies: Set<string>;
      externalImports: Set<string>;
      crossModuleImports: Set<string>;
    }
  >,
  moduleName: string,
) {
  const existing = modules.get(moduleName);
  if (existing) return existing;
  const created = {
    files: new Set<string>(),
    internalDependencies: new Set<string>(),
    externalImports: new Set<string>(),
    crossModuleImports: new Set<string>(),
  };
  modules.set(moduleName, created);
  return created;
}

function sorted(values: Set<string>): string[] {
  return Array.from(values).sort((left, right) => left.localeCompare(right));
}
