/** Repository scanner implementation. Performs filesystem observation only. */

import { access, lstat, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  createRepositoryId,
  type IRepositoryScanner,
  type IncrementalScanRequest,
  type RepositoryManifestEntry,
  type RepositoryDNA,
  type RepositoryScanResult,
  type ScannedFile,
} from '@project-dna/dna-core';
import {
  DEFAULT_IGNORE_PATTERNS,
  Err,
  FILE_SIZE_LIMIT_BYTES,
  Ok,
  isErr,
  type Logger,
  type Result,
} from '@project-dna/shared';
import { FrameworkDetector } from './detectors/framework-detector.js';
import { LanguageDetector } from './detectors/language-detector.js';
import { FileWalker, isIgnoredPath } from './file-walker.js';
import { ConfigReader, type JsonRecord } from './readers/config-reader.js';

const MANIFEST_READ_BATCH_SIZE = 32;

export interface RepositoryScannerDependencies {
  readonly logger: Logger;
  readonly fileWalker?: FileWalker;
  readonly configReader?: ConfigReader;
  readonly languageDetector?: LanguageDetector;
  readonly frameworkDetector?: FrameworkDetector;
}

export class RepositoryScanner implements IRepositoryScanner {
  private readonly logger: Logger;
  private readonly fileWalker: FileWalker;
  private readonly configReader: ConfigReader;
  private readonly languageDetector: LanguageDetector;
  private readonly frameworkDetector: FrameworkDetector;

  constructor(dependencies: Logger | RepositoryScannerDependencies) {
    const resolved = isLogger(dependencies) ? { logger: dependencies } : dependencies;
    this.logger = resolved.logger;
    this.fileWalker = resolved.fileWalker ?? new FileWalker();
    this.configReader = resolved.configReader ?? new ConfigReader();
    this.languageDetector = resolved.languageDetector ?? new LanguageDetector();
    this.frameworkDetector = resolved.frameworkDetector ?? new FrameworkDetector();
  }

  public async scan(rootPath: string, signal?: AbortSignal): Promise<Result<RepositoryScanResult>> {
    try {
      if (signal?.aborted) return Err(new Error('Repository scan cancelled'));

      const absoluteRoot = path.resolve(rootPath);
      const rootStats = await stat(absoluteRoot);
      if (!rootStats.isDirectory()) return Err(new Error(`${absoluteRoot} is not a directory`));

      const gitIgnoreResult = await this.configReader.readGitIgnore(absoluteRoot);
      if (isErr(gitIgnoreResult)) return gitIgnoreResult;

      const packageResult = await this.configReader.readPackageJson(absoluteRoot);
      if (isErr(packageResult)) return packageResult;

      const tsConfigResult = await this.configReader.readConfig(absoluteRoot);
      if (isErr(tsConfigResult)) return tsConfigResult;

      const ignorePatterns = [...DEFAULT_IGNORE_PATTERNS, ...gitIgnoreResult.value];
      const allFiles = await this.fileWalker.walk(absoluteRoot, { ignorePatterns, signal });
      const repositoryManifest = await this.createRepositoryManifest(
        absoluteRoot,
        allFiles,
        signal,
      );
      const manifest = toScannedFiles(repositoryManifest);
      const languages = this.languageDetector.detect(manifest.map((file) => file.path));
      const frameworks = this.frameworkDetector.detect(packageResult.value);
      const now = Date.now();

      const repository: RepositoryDNA = {
        id: createRepositoryId(absoluteRoot),
        name: path.basename(absoluteRoot),
        rootPath: absoluteRoot,
        languages,
        frameworks,
        packageManager: await detectPackageManager(absoluteRoot),
        metadata: {
          hasReadme: hasNamedFile(allFiles, /^readme(?:\.[^.]+)?$/iu),
          hasLicense: hasNamedFile(allFiles, /^licen[cs]e(?:\.[^.]+)?$/iu),
          hasGitIgnore:
            gitIgnoreResult.value.length > 0 ||
            (await exists(path.join(absoluteRoot, '.gitignore'))),
          hasTsConfig: tsConfigResult.value !== null,
          hasPackageJson: packageResult.value !== null,
          ...readPackageMetadata(packageResult.value),
        },
        totalFiles: allFiles.length,
        totalLinesOfCode: countManifestLines(repositoryManifest),
        createdAt: now,
        updatedAt: now,
      };

      this.logger.info(
        `Scanned ${absoluteRoot}: ${repository.totalFiles} files, ${manifest.length} source files`,
      );
      return Ok({ repository, files: manifest, manifest: repositoryManifest });
    } catch (error) {
      const resolvedError = error instanceof Error ? error : new Error(String(error));
      this.logger.error(`Repository scan failed: ${resolvedError.message}`);
      return Err(resolvedError);
    }
  }

  public async scanIncremental(
    request: IncrementalScanRequest,
    signal?: AbortSignal,
  ): Promise<Result<RepositoryScanResult>> {
    try {
      if (signal?.aborted) return Err(new Error('Repository scan cancelled'));
      if (!request.previous.manifest) return this.scan(request.rootPath, signal);

      const absoluteRoot = path.resolve(request.rootPath);
      if (request.changedPaths.some((filePath) => requiresFullScan(absoluteRoot, filePath))) {
        return this.scan(absoluteRoot, signal);
      }

      const gitIgnoreResult = await this.configReader.readGitIgnore(absoluteRoot);
      if (isErr(gitIgnoreResult)) return gitIgnoreResult;
      const ignorePatterns = [...DEFAULT_IGNORE_PATTERNS, ...gitIgnoreResult.value];
      const manifestByPath = new Map(
        request.previous.manifest.map((entry) => [comparisonPath(entry.relativePath), entry]),
      );
      const previousDirectories = manifestDirectoryKeys(request.previous.manifest);
      const changedPaths = [
        ...new Set(request.changedPaths.map((filePath) => path.resolve(filePath))),
      ].sort((left, right) => left.localeCompare(right));

      for (const changedPath of changedPaths) {
        if (signal?.aborted) return Err(new Error('Repository scan cancelled'));
        const relativePath = normalizePath(path.relative(absoluteRoot, changedPath));
        if (!relativePath || relativePath === '..' || relativePath.startsWith('../')) {
          return Err(new Error(`Changed path is outside repository root: ${changedPath}`));
        }
        const key = comparisonPath(relativePath);
        if ((await isDirectoryPath(changedPath)) || previousDirectories.has(key)) {
          return this.scan(absoluteRoot, signal);
        }
        if (isIgnoredPath(relativePath, false, ignorePatterns)) {
          manifestByPath.delete(key);
          continue;
        }

        const entry = await this.readManifestEntry(absoluteRoot, changedPath, signal);
        if (entry) manifestByPath.set(key, entry);
        else manifestByPath.delete(key);
      }

      const repositoryManifest = [...manifestByPath.values()].sort((left, right) =>
        left.relativePath.localeCompare(right.relativePath),
      );
      const files = toScannedFiles(repositoryManifest);
      const repository = updateRepository(
        request.previous.repository,
        repositoryManifest,
        this.languageDetector,
      );
      this.logger.info(
        `Reconciled ${changedPaths.length} changed paths in ${absoluteRoot}: ${repository.totalFiles} files`,
      );
      return Ok({ repository, files, manifest: repositoryManifest });
    } catch (error) {
      const resolvedError = error instanceof Error ? error : new Error(String(error));
      this.logger.error(`Incremental repository scan failed: ${resolvedError.message}`);
      return Err(resolvedError);
    }
  }

  private async createRepositoryManifest(
    rootPath: string,
    filePaths: readonly string[],
    signal?: AbortSignal,
  ): Promise<RepositoryManifestEntry[]> {
    const files: RepositoryManifestEntry[] = [];

    for (let offset = 0; offset < filePaths.length; offset += MANIFEST_READ_BATCH_SIZE) {
      if (signal?.aborted) throw new Error('Repository scan cancelled');
      const batch = filePaths.slice(offset, offset + MANIFEST_READ_BATCH_SIZE);
      const inspected = await Promise.allSettled(
        batch.map((filePath) => this.inspectManifestEntry(rootPath, filePath, signal)),
      );
      for (const result of inspected) {
        if (result.status === 'rejected') throw result.reason;
        if (result.value.warning) this.logger.warn(result.value.warning);
        if (result.value.entry) files.push(result.value.entry);
      }
    }

    return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  }

  private async readManifestEntry(
    rootPath: string,
    filePath: string,
    signal?: AbortSignal,
  ): Promise<RepositoryManifestEntry | null> {
    const result = await this.inspectManifestEntry(rootPath, filePath, signal);
    if (result.warning) this.logger.warn(result.warning);
    return result.entry;
  }

  private async inspectManifestEntry(
    rootPath: string,
    filePath: string,
    signal?: AbortSignal,
  ): Promise<ManifestInspection> {
    try {
      const fileStats = await lstat(filePath);
      if (!fileStats.isFile()) return { entry: null, warning: null };
      const language = this.languageDetector.detectFile(filePath);
      const analyzable = language !== null && fileStats.size <= FILE_SIZE_LIMIT_BYTES;
      let linesOfCode = 0;
      let warning: string | null = null;
      if (analyzable) {
        try {
          if (signal?.aborted) throw new Error('Repository scan cancelled');
          linesOfCode = countContentLines(await readFile(filePath, 'utf8'));
        } catch (error) {
          if (signal?.aborted) throw error;
          warning = `Could not count lines for ${filePath}: ${String(error)}`;
        }
      }
      return {
        entry: {
          path: filePath,
          relativePath: normalizePath(path.relative(rootPath, filePath)),
          size: fileStats.size,
          modifiedAtMs: fileStats.mtimeMs,
          ...(language ? { language: language.id } : {}),
          analyzable,
          linesOfCode,
        },
        warning,
      };
    } catch (error) {
      if (isMissingPathError(error)) return { entry: null, warning: null };
      throw error;
    }
  }
}

function toScannedFiles(manifest: readonly RepositoryManifestEntry[]): ScannedFile[] {
  const files: ScannedFile[] = [];
  for (const entry of manifest) {
    if (!entry.analyzable || entry.language === undefined) continue;
    files.push({
      path: entry.path,
      relativePath: entry.relativePath,
      language: entry.language,
      size: entry.size,
    });
  }
  return files;
}

function countManifestLines(manifest: readonly RepositoryManifestEntry[]): number {
  return manifest.reduce((total, entry) => total + entry.linesOfCode, 0);
}

function countContentLines(content: string): number {
  let count = 0;
  let start = 0;
  while (start <= content.length) {
    const end = content.indexOf('\n', start);
    const lineEnd = end === -1 ? content.length : end;
    if (content.slice(start, lineEnd).trim().length > 0) count++;
    if (end === -1) break;
    start = end + 1;
  }
  return count;
}

interface ManifestInspection {
  readonly entry: RepositoryManifestEntry | null;
  readonly warning: string | null;
}

function updateRepository(
  previous: RepositoryDNA,
  manifest: readonly RepositoryManifestEntry[],
  languageDetector: LanguageDetector,
): RepositoryDNA {
  const paths = manifest.map((entry) => entry.path);
  return {
    ...previous,
    languages: languageDetector.detect(
      manifest.filter((entry) => entry.analyzable).map((entry) => entry.path),
    ),
    metadata: {
      ...previous.metadata,
      hasReadme: hasNamedFile(paths, /^readme(?:\.[^.]+)?$/iu),
      hasLicense: hasNamedFile(paths, /^licen[cs]e(?:\.[^.]+)?$/iu),
    },
    totalFiles: manifest.length,
    totalLinesOfCode: countManifestLines(manifest),
    updatedAt: Date.now(),
  };
}

function requiresFullScan(rootPath: string, filePath: string): boolean {
  const relativePath = normalizePath(path.relative(rootPath, path.resolve(filePath))).toLowerCase();
  const name = path.posix.basename(relativePath);
  return (
    name === '.gitignore' ||
    name === 'package.json' ||
    name === 'pnpm-lock.yaml' ||
    name === 'package-lock.json' ||
    name === 'yarn.lock' ||
    name === 'bun.lock' ||
    name === 'bun.lockb' ||
    /^tsconfig(?:\.[^.]+)?\.json$/u.test(name)
  );
}

function comparisonPath(value: string): string {
  const normalized = normalizePath(value);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function manifestDirectoryKeys(manifest: readonly RepositoryManifestEntry[]): Set<string> {
  const directories = new Set<string>();
  for (const entry of manifest) {
    const segments = normalizePath(entry.relativePath).split('/');
    for (let index = 1; index < segments.length; index++) {
      directories.add(comparisonPath(segments.slice(0, index).join('/')));
    }
  }
  return directories;
}

function normalizePath(value: string): string {
  return value.replace(/\\/gu, '/').replace(/^\.\//u, '');
}

function isMissingPathError(error: unknown): boolean {
  return (
    error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

async function detectPackageManager(rootPath: string): Promise<string | undefined> {
  if (await exists(path.join(rootPath, 'pnpm-lock.yaml'))) return 'pnpm';
  if (await exists(path.join(rootPath, 'yarn.lock'))) return 'yarn';
  if (await exists(path.join(rootPath, 'bun.lockb'))) return 'bun';
  if (await exists(path.join(rootPath, 'bun.lock'))) return 'bun';
  if (await exists(path.join(rootPath, 'package-lock.json'))) return 'npm';
  return undefined;
}

function hasNamedFile(filePaths: readonly string[], pattern: RegExp): boolean {
  return filePaths.some((filePath) => pattern.test(path.basename(filePath)));
}

function readPackageMetadata(packageJson: JsonRecord | null): {
  description?: string;
  version?: string;
} {
  if (!packageJson) return {};
  return {
    ...(typeof packageJson['description'] === 'string'
      ? { description: packageJson['description'] }
      : {}),
    ...(typeof packageJson['version'] === 'string' ? { version: packageJson['version'] } : {}),
  };
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function isDirectoryPath(filePath: string): Promise<boolean> {
  try {
    return (await lstat(filePath)).isDirectory();
  } catch (error) {
    if (isMissingPathError(error)) return false;
    throw error;
  }
}

function isLogger(value: Logger | RepositoryScannerDependencies): value is Logger {
  return 'info' in value && typeof value.info === 'function';
}
