/** Readers for common repository configuration files. */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Err, Ok, type Result } from '@project-dna/shared';

export type JsonRecord = Record<string, unknown>;

export class ConfigReader {
  public readPackageJson(rootPath: string): Promise<Result<JsonRecord | null>> {
    return this.readJsonFile(path.join(rootPath, 'package.json'));
  }

  public readConfig(rootPath: string): Promise<Result<JsonRecord | null>> {
    return this.readJsonFile(path.join(rootPath, 'tsconfig.json'), true);
  }

  public async readGitIgnore(rootPath: string): Promise<Result<string[]>> {
    try {
      const content = await readFile(path.join(rootPath, '.gitignore'), 'utf8');
      return Ok(
        content
          .split(/\r?\n/u)
          .map((line) => line.trim())
          .filter((line) => line.length > 0 && !line.startsWith('#')),
      );
    } catch (error) {
      if (isMissingFileError(error)) return Ok([]);
      return Err(toError(error));
    }
  }

  private async readJsonFile(
    filePath: string,
    allowComments = false,
  ): Promise<Result<JsonRecord | null>> {
    try {
      const content = await readFile(filePath, 'utf8');
      const json = JSON.parse(allowComments ? stripJsonComments(content) : content) as unknown;
      if (!isJsonRecord(json)) return Err(new Error(`${filePath} must contain a JSON object`));
      return Ok(json);
    } catch (error) {
      if (isMissingFileError(error)) return Ok(null);
      return Err(toError(error));
    }
  }
}

function stripJsonComments(content: string): string {
  return content
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/^\s*\/\/.*$/gmu, '')
    .replace(/,\s*([}\]])/gu, '$1');
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
