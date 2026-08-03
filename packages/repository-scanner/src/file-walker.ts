/** Recursively walks a repository without following symbolic links. */

import { readdir } from 'node:fs/promises';
import path from 'node:path';

export interface WalkOptions {
  readonly ignorePatterns?: readonly string[];
  readonly signal?: AbortSignal;
}

export class FileWalker {
  public async walk(rootPath: string, options: WalkOptions = {}): Promise<string[]> {
    const files: string[] = [];
    const patterns = options.ignorePatterns ?? [];

    await this.visit(
      path.resolve(rootPath),
      path.resolve(rootPath),
      patterns,
      files,
      options.signal,
    );
    return files.sort((left, right) => left.localeCompare(right));
  }

  private async visit(
    rootPath: string,
    directory: string,
    patterns: readonly string[],
    files: string[],
    signal?: AbortSignal,
  ): Promise<void> {
    if (signal?.aborted) throw new Error('Repository scan cancelled');

    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (signal?.aborted) throw new Error('Repository scan cancelled');

      const absolutePath = path.join(directory, entry.name);
      const relativePath = normalizePath(path.relative(rootPath, absolutePath));
      if (isIgnored(relativePath, entry.isDirectory(), patterns)) continue;

      if (entry.isDirectory()) {
        await this.visit(rootPath, absolutePath, patterns, files, signal);
      } else if (entry.isFile()) {
        files.push(absolutePath);
      }
    }
  }
}

function isIgnored(
  relativePath: string,
  isDirectory: boolean,
  patterns: readonly string[],
): boolean {
  const segments = relativePath.split('/');

  return patterns.some((rawPattern) => {
    const pattern = normalizePattern(rawPattern);
    if (!pattern || pattern.startsWith('!')) return false;

    const directoryPattern = pattern.endsWith('/');
    const normalized = directoryPattern ? pattern.slice(0, -1) : pattern;

    if (!normalized.includes('/')) {
      if (segments.some((segment) => matchesSegment(segment, normalized))) return true;
    }

    if (matchesPath(relativePath, normalized)) return true;
    return isDirectory && directoryPattern && relativePath.startsWith(`${normalized}/`);
  });
}

function matchesSegment(value: string, pattern: string): boolean {
  return globToRegExp(pattern, false).test(value);
}

function matchesPath(value: string, pattern: string): boolean {
  return globToRegExp(pattern, true).test(value);
}

function globToRegExp(pattern: string, pathAware: boolean): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '___DOUBLE_STAR___')
    .replace(/\*/g, pathAware ? '[^/]*' : '.*')
    .replace(/\?/g, pathAware ? '[^/]' : '.');
  const source = escaped.replace(/___DOUBLE_STAR___/g, '.*');
  return new RegExp(`^(?:${source})(?:/.*)?$`, 'i');
}

function normalizePattern(pattern: string): string {
  return normalizePath(pattern.trim().replace(/^\//, ''));
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/');
}
