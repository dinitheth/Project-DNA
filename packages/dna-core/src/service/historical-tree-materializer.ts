import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdir, mkdtemp, readlink, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Err, Ok, type Result } from '@project-dna/shared';
import type {
  HistoricalTreeMaterializationOptions,
  IHistoricalTreeMaterializer,
  MaterializedHistoricalTree,
} from '../interfaces/historical-tree.interface.js';

const DEFAULT_OPTIONS = {
  maxArchiveBytes: 256 * 1024 * 1024,
  maxFiles: 50_000,
  maxExtractedBytes: 512 * 1024 * 1024,
  maxFileBytes: 64 * 1024 * 1024,
} as const;
const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const HARD_OPTIONS = {
  maxArchiveBytes: 512 * 1024 * 1024,
  maxFiles: 100_000,
  maxExtractedBytes: 1024 * 1024 * 1024,
  maxFileBytes: 256 * 1024 * 1024,
} as const;
const COMMAND_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

export class HistoricalTreeError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'invalid-tree'
      | 'archive-limit'
      | 'file-limit'
      | 'extracted-limit'
      | 'unsafe-entry'
      | 'nested-git'
      | 'symlink-escape'
      | 'timeout'
      | 'cancelled'
      | 'unavailable',
  ) {
    super(message);
    this.name = 'HistoricalTreeError';
  }
}

export class HistoricalTreeMaterializer implements IHistoricalTreeMaterializer {
  async materialize(
    repositoryRoot: string,
    treeSha: string,
    options: HistoricalTreeMaterializationOptions = {},
    signal?: AbortSignal,
  ): Promise<Result<MaterializedHistoricalTree>> {
    let privateRoot: string | null = null;
    try {
      if (!/^[0-9a-f]{40}$/u.test(treeSha))
        throw new HistoricalTreeError('Expected a full lowercase tree SHA', 'invalid-tree');
      const limits = parseLimits(options);
      if (signal?.aborted)
        throw new HistoricalTreeError('Tree materialization cancelled', 'cancelled');
      privateRoot = await mkdtemp(path.join(os.tmpdir(), 'project-dna-commit-tree-'));
      const archivePath = path.join(privateRoot, 'tree.tar');
      const extractedRoot = path.join(privateRoot, 'content');
      await mkdir(extractedRoot);
      const entries = await listTree(repositoryRoot, treeSha, signal);
      validateEntries(entries, limits.maxFiles);
      const archiveBytes =
        treeSha === EMPTY_TREE_SHA
          ? 0
          : await archiveTree(repositoryRoot, treeSha, archivePath, limits.maxArchiveBytes, signal);
      if (treeSha !== EMPTY_TREE_SHA) {
        const archiveEntries = await listArchive(archivePath, signal);
        validateEntries(archiveEntries, limits.maxFiles);
      }
      if (treeSha !== EMPTY_TREE_SHA) await extractArchive(archivePath, extractedRoot, signal);
      const measured = await measureExtractedTree(extractedRoot, limits, signal);
      const contentFingerprint = await hashExtractedTree(extractedRoot, signal);
      const materialized: MaterializedHistoricalTree = {
        treeSha,
        rootPath: extractedRoot,
        archiveBytes,
        extractedBytes: measured.bytes,
        fileCount: measured.files,
        contentFingerprint,
        cleanup: async () => {
          if (!privateRoot) return;
          const root = privateRoot;
          privateRoot = null;
          await rm(root, { recursive: true, force: true });
        },
      };
      return Ok(materialized);
    } catch (error) {
      if (privateRoot)
        await rm(privateRoot, { recursive: true, force: true }).catch(() => undefined);
      return Err(
        error instanceof Error ? error : new HistoricalTreeError(String(error), 'unavailable'),
      );
    }
  }
}

interface Limits {
  readonly maxArchiveBytes: number;
  readonly maxFiles: number;
  readonly maxExtractedBytes: number;
  readonly maxFileBytes: number;
}

function parseLimits(options: HistoricalTreeMaterializationOptions): Limits {
  const limits = {
    maxArchiveBytes: options.maxArchiveBytes ?? DEFAULT_OPTIONS.maxArchiveBytes,
    maxFiles: options.maxFiles ?? DEFAULT_OPTIONS.maxFiles,
    maxExtractedBytes: options.maxExtractedBytes ?? DEFAULT_OPTIONS.maxExtractedBytes,
    maxFileBytes: options.maxFileBytes ?? DEFAULT_OPTIONS.maxFileBytes,
  };
  for (const [key, value] of Object.entries(limits)) {
    const maximum = HARD_OPTIONS[key as keyof typeof HARD_OPTIONS];
    if (!Number.isSafeInteger(value) || value <= 0 || value > maximum)
      throw new HistoricalTreeError(`Invalid ${key} limit`, 'archive-limit');
  }
  return limits;
}

async function archiveTree(
  repositoryRoot: string,
  treeSha: string,
  archivePath: string,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['archive', '--format=tar', treeSha], {
      cwd: repositoryRoot,
      windowsHide: true,
      env: sanitizedEnvironment(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const output = createWriteStream(archivePath, { flags: 'wx' });
    let bytes = 0;
    let stderr = '';
    let settled = false;
    let childClosed = false;
    let outputFinished = false;
    const timer = setTimeout(
      () => finish(new HistoricalTreeError('Git archive timed out', 'timeout')),
      COMMAND_TIMEOUT_MS,
    );
    const abort = () =>
      finish(new HistoricalTreeError('Tree materialization cancelled', 'cancelled'));
    signal?.addEventListener('abort', abort, { once: true });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
      if (stderr.length > MAX_OUTPUT_BYTES)
        finish(new HistoricalTreeError('Git archive error output exceeded limit', 'archive-limit'));
    });
    child.stdout.on('data', (chunk: Buffer) => {
      if (settled) return;
      bytes += chunk.length;
      if (bytes > maxBytes) {
        finish(new HistoricalTreeError('Git archive exceeded byte limit', 'archive-limit'));
        return;
      }
      if (!output.write(chunk)) child.stdout.pause();
    });
    output.on('drain', () => child.stdout.resume());
    child.stdout.on('end', () => output.end());
    output.once('error', (error) =>
      finish(new HistoricalTreeError(`Archive write failed: ${error.message}`, 'unavailable')),
    );
    output.once('finish', () => {
      outputFinished = true;
      if (childClosed) finish(null, bytes);
    });
    child.once('error', (error) =>
      finish(new HistoricalTreeError(`Git archive unavailable: ${error.message}`, 'unavailable')),
    );
    child.once('close', (code) => {
      if (settled) return;
      if (code !== 0)
        finish(
          new HistoricalTreeError(
            stderr.trim() || `Git archive exited with ${code ?? 'unknown'}`,
            'unavailable',
          ),
        );
      else {
        childClosed = true;
        if (outputFinished) finish(null, bytes);
      }
    });
    function finish(error: Error | null, value = 0): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (error) {
        child.stdout.destroy();
        output.destroy();
        terminateProcessTree(child);
        reject(error);
      } else resolve(value);
    }
  });
}

async function listTree(
  repositoryRoot: string,
  treeSha: string,
  signal?: AbortSignal,
): Promise<string[]> {
  if (treeSha === EMPTY_TREE_SHA) return [];
  const output = await runProcess(
    'git',
    ['-c', 'core.quotepath=false', 'ls-tree', '-rz', '--name-only', treeSha],
    signal,
    repositoryRoot,
  );
  return output.split('\0').filter(Boolean).map(normalizeArchiveEntry);
}

async function listArchive(archivePath: string, signal?: AbortSignal): Promise<string[]> {
  const output = await runProcess('tar', ['-tf', archivePath], signal);
  return output.split(/\r?\n/u).filter(Boolean).map(normalizeArchiveEntry);
}

async function extractArchive(
  archivePath: string,
  destination: string,
  signal?: AbortSignal,
): Promise<void> {
  await runProcess(
    'tar',
    ['-xf', archivePath, '-C', destination, '--no-same-owner', '--no-same-permissions'],
    signal,
  );
}

function validateEntries(entries: readonly string[], maxFiles: number): void {
  if (entries.length > HARD_OPTIONS.maxFiles || entries.length > maxFiles)
    throw new HistoricalTreeError('Archive file count exceeds limit', 'file-limit');
  for (const entry of entries) {
    if (
      !entry ||
      entry.startsWith('/') ||
      /^[A-Za-z]:/u.test(entry) ||
      entry.split('/').includes('..')
    )
      throw new HistoricalTreeError(`Unsafe archive entry: ${entry}`, 'unsafe-entry');
    if (entry === '.git' || entry.startsWith('.git/'))
      throw new HistoricalTreeError(`Nested Git metadata is not allowed: ${entry}`, 'nested-git');
  }
}

async function measureExtractedTree(
  root: string,
  limits: Limits,
  signal?: AbortSignal,
): Promise<{ files: number; bytes: number }> {
  let files = 0;
  let bytes = 0;
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (signal?.aborted)
        throw new HistoricalTreeError('Tree materialization cancelled', 'cancelled');
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).replaceAll('\\', '/');
      if (entry.name === '.git' || relative.split('/').includes('.git'))
        throw new HistoricalTreeError(
          `Nested Git metadata is not allowed: ${relative}`,
          'nested-git',
        );
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) {
        const target = await readlink(absolute);
        const resolved = path.resolve(path.dirname(absolute), target);
        if (!isWithin(root, resolved))
          throw new HistoricalTreeError(
            `Symlink escapes archive root: ${relative}`,
            'symlink-escape',
          );
        files++;
      } else if (info.isDirectory()) await visit(absolute);
      else if (info.isFile()) {
        files++;
        if (info.size > limits.maxFileBytes)
          throw new HistoricalTreeError(`File exceeds size limit: ${relative}`, 'extracted-limit');
        bytes += info.size;
      }
      if (files > limits.maxFiles)
        throw new HistoricalTreeError('Extracted file count exceeds limit', 'file-limit');
      if (bytes > limits.maxExtractedBytes)
        throw new HistoricalTreeError('Extracted bytes exceed limit', 'extracted-limit');
    }
  };
  await visit(root);
  return { files, bytes };
}

async function hashExtractedTree(root: string, signal?: AbortSignal): Promise<string> {
  const entries: Array<{ path: string; digest: string }> = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (signal?.aborted)
        throw new HistoricalTreeError('Tree materialization cancelled', 'cancelled');
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).replaceAll('\\', '/');
      const info = await lstat(absolute);
      if (info.isDirectory()) await visit(absolute);
      else if (info.isSymbolicLink())
        entries.push({ path: relative, digest: `symlink:${await readlink(absolute)}` });
      else if (info.isFile())
        entries.push({ path: relative, digest: await digestFile(absolute, signal) });
    }
  };
  await visit(root);
  entries.sort((left, right) => left.path.localeCompare(right.path));
  return createHash('sha256').update(JSON.stringify(entries)).digest('hex');
}

async function digestFile(filePath: string, signal?: AbortSignal): Promise<string> {
  const hash = createHash('sha256');
  const stream = createReadStream(filePath);
  for await (const chunk of stream) {
    if (signal?.aborted) {
      stream.destroy();
      throw new HistoricalTreeError('Tree materialization cancelled', 'cancelled');
    }
    hash.update(chunk as Buffer);
  }
  return hash.digest('hex');
}

function runProcess(
  command: string,
  args: readonly string[],
  signal?: AbortSignal,
  cwd?: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      ...(cwd ? { cwd } : {}),
      env: sanitizedEnvironment(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(
      () => finish(new HistoricalTreeError(`${command} timed out`, 'timeout')),
      COMMAND_TIMEOUT_MS,
    );
    const abort = () =>
      finish(new HistoricalTreeError('Tree materialization cancelled', 'cancelled'));
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      if (stdout.length > MAX_OUTPUT_BYTES)
        finish(new HistoricalTreeError(`${command} output exceeded limit`, 'file-limit'));
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
      if (stderr.length > MAX_OUTPUT_BYTES)
        finish(new HistoricalTreeError(`${command} error output exceeded limit`, 'file-limit'));
    });
    child.once('error', (error) =>
      finish(new HistoricalTreeError(`${command} unavailable: ${error.message}`, 'unavailable')),
    );
    child.once('close', (code) => {
      if (code === 0) finish(null, stdout);
      else
        finish(
          new HistoricalTreeError(
            stderr.trim() || `${command} exited with ${code ?? 'unknown'}`,
            'unavailable',
          ),
        );
    });
    function finish(error: Error | null, value = ''): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (error) {
        terminateProcessTree(child);
        reject(error);
      } else resolve(value);
    }
  });
}

function normalizeArchiveEntry(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\.\//u, '').replace(/\/$/u, '');
}
function isWithin(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}
function sanitizedEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_CONFIG_NOSYSTEM: '1',
  };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  delete env.GIT_ASKPASS;
  delete env.SSH_ASKPASS;
  return env;
}
function terminateProcessTree(child: ReturnType<typeof spawn>): void {
  if (child.pid === undefined) return;
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    killer.unref();
  } else child.kill('SIGKILL');
}
