import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readlink, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Err, Ok } from '@project-dna/shared';
import type { Result } from '@project-dna/shared';
import type { IWorkingTreeChangeSetProvider } from '../interfaces/working-tree-impact.interface.js';
import {
  WorkingTreeChangeSetSchema,
  type WorkingTreeChangeSet,
  type WorkingTreeChangedPath,
  type WorkingTreeContentKind,
} from '../models/working-tree-impact.js';

const DEFAULT_MAX_CHANGED_PATHS = 10_000;
const HARD_MAX_CHANGED_PATHS = 10_000;
const COMMAND_TIMEOUT_MS = 15_000;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const HASH_CHUNK_BYTES = 64 * 1024;
const CLASSIFICATION_CONCURRENCY = 32;

export class WorkingTreeGitError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'not-a-repository'
      | 'no-commit'
      | 'conflict'
      | 'invalid-output'
      | 'timeout'
      | 'cancelled'
      | 'output-limit'
      | 'path-security'
      | 'unavailable'
      | 'unstable-file',
  ) {
    super(message);
    this.name = 'WorkingTreeGitError';
  }
}

interface GitRecord {
  readonly status: string;
  readonly path: string;
  readonly previousPath?: string;
  readonly staged: boolean;
  readonly unstaged: boolean;
  readonly untracked: boolean;
}

export class GitChangeSetProvider implements IWorkingTreeChangeSetProvider {
  async getWorkingTreeChangeSet(
    rootPath: string,
    options: { readonly maxChangedPaths?: number } = {},
    signal?: AbortSignal,
  ): Promise<Result<WorkingTreeChangeSet>> {
    try {
      const maxChangedPaths = options.maxChangedPaths ?? DEFAULT_MAX_CHANGED_PATHS;
      if (
        !Number.isInteger(maxChangedPaths) ||
        maxChangedPaths <= 0 ||
        maxChangedPaths > HARD_MAX_CHANGED_PATHS
      ) {
        return Err(new WorkingTreeGitError('Invalid changed-path bound', 'invalid-output'));
      }
      if (signal?.aborted) return Err(new WorkingTreeGitError('Git query cancelled', 'cancelled'));
      const requestedRoot = await realpath(rootPath).catch(() => {
        throw new WorkingTreeGitError(
          `Repository root does not exist: ${rootPath}`,
          'path-security',
        );
      });
      const gitVersion = normalizeOutput(await this.runGit(['--version'], requestedRoot, signal));
      const gitRoot = normalizeAbsolute(
        await this.runGit(['rev-parse', '--show-toplevel'], requestedRoot, signal),
      );
      const canonicalGitRoot = await realpath(gitRoot).catch(() => gitRoot);
      if (comparisonPath(requestedRoot) !== comparisonPath(canonicalGitRoot)) {
        throw new WorkingTreeGitError(
          'Git root does not match the Project DNA analysis root',
          'path-security',
        );
      }
      const headCommit = normalizeOutput(
        await this.runGit(['rev-parse', '--verify', 'HEAD'], canonicalGitRoot, signal),
      );
      if (!/^[0-9a-f]{4,}$/u.test(headCommit)) {
        throw new WorkingTreeGitError('Repository has no verifiable HEAD commit', 'no-commit');
      }
      const conflicts = await this.runGit(['ls-files', '-u', '-z'], canonicalGitRoot, signal);
      if (conflicts.length > 0)
        throw new WorkingTreeGitError('Repository has unresolved index conflicts', 'conflict');

      const statusOutput = await this.runGit(
        [
          '-c',
          'status.renames=true',
          '-c',
          'diff.renames=true',
          'status',
          '--porcelain=v1',
          '-z',
          '--untracked-files=all',
          '--find-renames=50%',
        ],
        canonicalGitRoot,
        signal,
      );
      const records = parsePorcelainStatus(statusOutput);
      const untracked = records.filter((record) => record.untracked).map((record) => record.path);

      const sortedRecords = [...records.values()].sort(compareRecords);
      if (sortedRecords.length > HARD_MAX_CHANGED_PATHS) {
        throw new WorkingTreeGitError(
          'Working-tree change output exceeds the hard bound',
          'output-limit',
        );
      }
      const changes = await mapBounded(sortedRecords, CLASSIFICATION_CONCURRENCY, (record) =>
        this.toChangedPath(canonicalGitRoot, record, signal),
      );
      const trackedPaths = parseUntracked(
        await this.runGit(['ls-files', '-z'], canonicalGitRoot, signal),
      );
      const contentPaths = [
        ...new Set([
          ...trackedPaths,
          ...untracked,
          ...changes.flatMap((change) =>
            change.previousPath ? [change.path, change.previousPath] : [change.path],
          ),
        ]),
      ].sort(compareStrings);
      const contentFingerprint = await hashScopedContent(canonicalGitRoot, contentPaths, signal);
      const canonicalStatus = changes.map((change) => ({
        ...change,
        previousPath: change.previousPath ?? null,
      }));
      const indexFingerprint = sha256(
        await this.runGit(['ls-files', '--stage', '-z'], canonicalGitRoot, signal),
      );
      const changeSetFingerprint = sha256(
        JSON.stringify({
          headCommit,
          gitVersion,
          indexFingerprint,
          status: canonicalStatus,
          contentFingerprint,
        }),
      );
      const truncated = changes.length > maxChangedPaths;
      return Ok(
        WorkingTreeChangeSetSchema.parse({
          headCommit,
          gitVersion,
          changes: changes.slice(0, maxChangedPaths),
          changeSetFingerprint,
          contentFingerprint,
          complete: !truncated,
          truncations: truncated ? [{ kind: 'max-changed-paths', limit: maxChangedPaths }] : [],
        }),
      );
    } catch (error) {
      return Err(
        error instanceof Error ? error : new WorkingTreeGitError(String(error), 'unavailable'),
      );
    }
  }

  private async toChangedPath(
    root: string,
    record: GitRecord,
    signal?: AbortSignal,
  ): Promise<WorkingTreeChangedPath> {
    const currentPath = normalizeRelative(record.path);
    const previousPath = record.previousPath ? normalizeRelative(record.previousPath) : undefined;
    const contentKind = await classifyPath(path.join(root, currentPath), signal);
    const kind =
      record.status === 'R'
        ? 'renamed'
        : record.status === 'T'
          ? 'type-changed'
          : record.status === 'A'
            ? 'added'
            : record.status === 'D'
              ? 'deleted'
              : 'modified';
    return {
      kind,
      path: currentPath,
      ...(previousPath ? { previousPath } : {}),
      staged: record.staged,
      unstaged: record.unstaged,
      untracked: record.untracked,
      contentKind,
    };
  }

  private async runGit(
    args: readonly string[],
    cwd: string,
    signal?: AbortSignal,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn('git', args, {
        cwd,
        windowsHide: true,
        env: sanitizedEnvironment(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = Buffer.alloc(0);
      let stderr = Buffer.alloc(0);
      let settled = false;
      const timer = setTimeout(
        () =>
          finish(
            new WorkingTreeGitError(`Git command timed out: git ${args.join(' ')}`, 'timeout'),
          ),
        COMMAND_TIMEOUT_MS,
      );
      const abort = () => finish(new WorkingTreeGitError('Git command cancelled', 'cancelled'));
      signal?.addEventListener('abort', abort, { once: true });
      const append = (target: 'stdout' | 'stderr', chunk: Buffer): void => {
        if (target === 'stdout') stdout = Buffer.concat([stdout, chunk]);
        else stderr = Buffer.concat([stderr, chunk]);
        if (stdout.length + stderr.length > MAX_OUTPUT_BYTES)
          finish(new WorkingTreeGitError('Git output exceeded the bounded limit', 'output-limit'));
      };
      child.stdout.on('data', (chunk: Buffer) => append('stdout', chunk));
      child.stderr.on('data', (chunk: Buffer) => append('stderr', chunk));
      child.once('error', (error) =>
        finish(new WorkingTreeGitError(`Git unavailable: ${error.message}`, 'unavailable')),
      );
      child.once('close', (code) => {
        if (settled) return;
        if (code === 0) finish(null, stdout.toString('utf8'));
        else if (args.includes('--show-toplevel'))
          finish(new WorkingTreeGitError('Path is not a Git repository', 'not-a-repository'));
        else if (args.includes('HEAD'))
          finish(new WorkingTreeGitError('Repository has no verifiable HEAD commit', 'no-commit'));
        else
          finish(
            new WorkingTreeGitError(
              stderr.toString('utf8').trim() || `Git exited with code ${code ?? 'unknown'}`,
              'unavailable',
            ),
          );
      });
      function finish(error: Error | null, value = ''): void {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        if (error) terminateProcessTree(child);
        if (error) reject(error);
        else resolve(value);
      }
    });
  }
}

function parsePorcelainStatus(output: string): GitRecord[] {
  const tokens = output.split('\0');
  const records: GitRecord[] = [];
  for (let index = 0; index < tokens.length;) {
    const token = tokens[index++];
    if (!token) continue;
    if (token.length < 4 || token[2] !== ' ') {
      throw new WorkingTreeGitError(`Malformed Git status record: ${token}`, 'invalid-output');
    }
    const x = token[0]!;
    const y = token[1]!;
    const relativePath = token.slice(3);
    if (isConflictStatus(x, y)) {
      throw new WorkingTreeGitError(
        `Repository has unresolved index conflict at ${relativePath}`,
        'conflict',
      );
    }
    if (isUnsafeRelativePath(relativePath)) {
      throw new WorkingTreeGitError(`Unsafe Git path: ${relativePath}`, 'path-security');
    }
    if (x === 'R' || y === 'R') {
      const previousPath = tokens[index++];
      if (!previousPath || isUnsafeRelativePath(previousPath))
        throw new WorkingTreeGitError('Malformed Git rename record', 'invalid-output');
      records.push({
        status: 'R',
        path: normalizeRelative(relativePath),
        previousPath: normalizeRelative(previousPath),
        staged: x !== ' ' && x !== '?',
        unstaged: y !== ' ' && y !== '?',
        untracked: false,
      });
      continue;
    }
    const untracked = x === '?' && y === '?';
    records.push({
      status: selectStatus(x, y, untracked),
      path: normalizeRelative(relativePath),
      staged: !untracked && x !== ' ',
      unstaged: untracked || y !== ' ',
      untracked,
    });
  }
  return records;
}

function selectStatus(x: string, y: string, untracked: boolean): string {
  if (untracked || x === 'A' || y === 'A') return 'A';
  if (x === 'D' || y === 'D') return 'D';
  if (x === 'T' || y === 'T') return 'T';
  if (x === 'M' || y === 'M') return 'M';
  throw new WorkingTreeGitError(`Unsupported Git status: ${x}${y}`, 'invalid-output');
}

function isConflictStatus(x: string, y: string): boolean {
  return ['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].includes(`${x}${y}`);
}

function parseUntracked(output: string): string[] {
  return output
    .split('\0')
    .filter(Boolean)
    .map((value) => {
      if (isUnsafeRelativePath(value))
        throw new WorkingTreeGitError(`Unsafe Git path: ${value}`, 'path-security');
      return normalizeRelative(value);
    });
}

async function classifyPath(
  filePath: string,
  signal?: AbortSignal,
): Promise<WorkingTreeContentKind> {
  if (signal?.aborted) throw new WorkingTreeGitError('File classification cancelled', 'cancelled');
  let info;
  try {
    info = await lstat(filePath);
  } catch {
    return 'unknown';
  }
  if (info.isSymbolicLink()) return 'symlink';
  if (info.isDirectory()) {
    try {
      const nestedGit = await lstat(path.join(filePath, '.git'));
      if (nestedGit.isFile() || nestedGit.isDirectory()) return 'submodule';
    } catch {
      // Ordinary directories remain unknown content.
    }
    return 'unknown';
  }
  if (!info.isFile()) return 'unknown';
  const stream = createReadStream(filePath, { start: 0, end: 8191 });
  for await (const chunk of stream) if ((chunk as Buffer).includes(0)) return 'binary';
  return 'text';
}

async function hashScopedContent(
  root: string,
  relativePaths: readonly string[],
  signal?: AbortSignal,
): Promise<string> {
  const entries: Array<{ path: string; digest: string }> = [];
  const paths = [...new Set(relativePaths)].sort(compareStrings);
  for (const relativePath of paths) {
    if (signal?.aborted) throw new WorkingTreeGitError('Content hashing cancelled', 'cancelled');
    const filePath = path.join(root, relativePath);
    let before;
    try {
      before = await lstat(filePath);
    } catch {
      entries.push({ path: relativePath, digest: 'deleted' });
      continue;
    }
    if (before.isSymbolicLink()) {
      entries.push({ path: relativePath, digest: sha256(`symlink:${await readlink(filePath)}`) });
      continue;
    }
    if (!before.isFile()) {
      entries.push({ path: relativePath, digest: sha256(`non-file:${relativePath}`) });
      continue;
    }
    const hash = createHash('sha256');
    const stream = createReadStream(filePath, { highWaterMark: HASH_CHUNK_BYTES });
    for await (const chunk of stream) {
      if (signal?.aborted) {
        stream.destroy();
        throw new WorkingTreeGitError('Content hashing cancelled', 'cancelled');
      }
      hash.update(chunk as Buffer);
    }
    const after = await stat(filePath);
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs)
      throw new WorkingTreeGitError(`File changed while hashing: ${relativePath}`, 'unstable-file');
    entries.push({ path: relativePath, digest: hash.digest('hex') });
  }
  return sha256(JSON.stringify(entries));
}

function sanitizedEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_OPTIONAL_LOCKS: '0',
  };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  return env;
}
function normalizeOutput(value: string): string {
  return value.replace(/[\r\n]+$/gu, '').trim();
}
function normalizeAbsolute(value: string): string {
  return path.resolve(normalizeOutput(value)).replaceAll('\\', '/').replace(/\/+$/u, '');
}
function normalizeRelative(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\.\//u, '');
}
function comparisonPath(value: string): string {
  const normalized = normalizeAbsolute(value);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}
function isUnsafeRelativePath(value: string): boolean {
  const normalized = normalizeRelative(value);
  return (
    normalized.startsWith('/') ||
    /^[A-Za-z]:/u.test(normalized) ||
    normalized.split('/').includes('..') ||
    normalized.includes('\0')
  );
}
function compareRecords(left: GitRecord, right: GitRecord): number {
  return (
    compareStrings(left.path, right.path) ||
    compareStrings(left.previousPath ?? '', right.previousPath ?? '') ||
    compareStrings(left.status, right.status)
  );
}
function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function mapBounded<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const index = nextIndex++;
      if (index >= values.length) return;
      results[index] = await mapper(values[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return results;
}

function terminateProcessTree(child: ReturnType<typeof spawn>): void {
  if (child.pid === undefined) {
    child.kill();
    return;
  }
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    killer.unref();
    return;
  }
  child.kill('SIGKILL');
}
