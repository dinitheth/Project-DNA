/** Repository scanner implementation. Performs filesystem observation only. */

import { createHash } from 'node:crypto';
import { access, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type {
  IRepositoryScanner,
  RepositoryDNA,
  RepositoryScanResult,
  ScannedFile,
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
import { FileWalker } from './file-walker.js';
import { ConfigReader, type JsonRecord } from './readers/config-reader.js';

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
      const manifest = await this.createManifest(absoluteRoot, allFiles, signal);
      const languages = this.languageDetector.detect(manifest.map((file) => file.path));
      const frameworks = this.frameworkDetector.detect(packageResult.value);
      const now = Date.now();

      const repository: RepositoryDNA = {
        id: createHash('sha256').update(absoluteRoot.toLowerCase()).digest('hex'),
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
        totalLinesOfCode: await countLines(manifest, signal),
        createdAt: now,
        updatedAt: now,
      };

      this.logger.info(
        `Scanned ${absoluteRoot}: ${repository.totalFiles} files, ${manifest.length} source files`,
      );
      return Ok({ repository, files: manifest });
    } catch (error) {
      const resolvedError = error instanceof Error ? error : new Error(String(error));
      this.logger.error(`Repository scan failed: ${resolvedError.message}`);
      return Err(resolvedError);
    }
  }

  private async createManifest(
    rootPath: string,
    filePaths: readonly string[],
    signal?: AbortSignal,
  ): Promise<ScannedFile[]> {
    const files: ScannedFile[] = [];

    for (const filePath of filePaths) {
      if (signal?.aborted) throw new Error('Repository scan cancelled');
      const language = this.languageDetector.detectFile(filePath);
      if (!language) continue;

      const fileStats = await stat(filePath);
      if (fileStats.size > FILE_SIZE_LIMIT_BYTES) continue;

      files.push({
        path: filePath,
        relativePath: path.relative(rootPath, filePath).replace(/\\/gu, '/'),
        language: language.id,
        size: fileStats.size,
      });
    }

    return files;
  }
}

async function countLines(files: readonly ScannedFile[], signal?: AbortSignal): Promise<number> {
  let total = 0;
  for (const file of files) {
    if (signal?.aborted) throw new Error('Repository scan cancelled');
    const content = await readFile(file.path, 'utf8');
    total += content.split(/\r?\n/u).filter((line) => line.trim().length > 0).length;
  }
  return total;
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

function isLogger(value: Logger | RepositoryScannerDependencies): value is Logger {
  return 'info' in value && typeof value.info === 'function';
}
