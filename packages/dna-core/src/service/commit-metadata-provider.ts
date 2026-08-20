import { realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Err, Ok, type Result } from '@project-dna/shared';
import type {
  CommitMetadata,
  ICommitMetadataProvider,
} from '../interfaces/commit-metadata.interface.js';
import {
  CommitChangedFileSchema,
  CommitImpactRequestSchema,
  type CommitChangedFile,
  type CommitFileContentKind,
} from '../models/commit-impact.js';
import type { IPullRequestTreeRangeProvider } from '../interfaces/pull-request-range.interface.js';
import {
  PullRequestImpactRequestSchema,
  pullRequestRequestFingerprint,
  type PullRequestTreeRangeMetadata,
} from '../models/pull-request-impact.js';

const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const RENAME_SIMILARITY = '50%';
const COMMAND_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
const HARD_MAX_CHANGED_FILES = 10_000;

export class CommitGitError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'not-a-repository'
      | 'invalid-request'
      | 'missing-commit'
      | 'missing-parent'
      | 'ambiguous-merge-parent'
      | 'invalid-parent'
      | 'unsupported-object-format'
      | 'invalid-output'
      | 'timeout'
      | 'cancelled'
      | 'output-limit'
      | 'path-security'
      | 'unavailable',
  ) {
    super(message);
    this.name = 'CommitGitError';
  }
}

export class PullRequestGitError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'invalid-request'
      | 'missing-base'
      | 'missing-head'
      | 'missing-merge-base'
      | 'ambiguous-merge-base'
      | 'missing-tree'
      | 'cancelled'
      | 'output-limit'
      | 'path-security'
      | 'unavailable',
  ) {
    super(message);
    this.name = 'PullRequestGitError';
  }
}

interface RawChangedFile {
  readonly oldMode: string;
  readonly newMode: string;
  readonly oldBlobSha: string;
  readonly newBlobSha: string;
  readonly status: string;
  readonly path: string;
  readonly previousPath?: string;
}

export class GitCommitMetadataProvider
  implements ICommitMetadataProvider, IPullRequestTreeRangeProvider
{
  async getPullRequestTreeRange(
    rootPath: string,
    request: unknown,
    options: { readonly maxChangedFiles?: number } = {},
    signal?: AbortSignal,
  ): Promise<Result<PullRequestTreeRangeMetadata>> {
    try {
      const parsed = PullRequestImpactRequestSchema.safeParse(request);
      if (!parsed.success) throw new PullRequestGitError(parsed.error.message, 'invalid-request');
      const maxChangedFiles = options.maxChangedFiles ?? 500;
      if (
        !Number.isInteger(maxChangedFiles) ||
        maxChangedFiles <= 0 ||
        maxChangedFiles > HARD_MAX_CHANGED_FILES
      )
        throw new PullRequestGitError('Invalid changed-file bound', 'invalid-request');
      if (signal?.aborted)
        throw new PullRequestGitError('Pull request query cancelled', 'cancelled');
      const root = await resolveGitRoot(rootPath, signal);
      const base = await inspectRangeCommit(root, parsed.data.baseSha, 'base', signal);
      const head = await inspectRangeCommit(root, parsed.data.headSha, 'head', signal);
      const mergeBases = await resolveMergeBases(root, base.commitSha, head.commitSha, signal);
      if (mergeBases.length === 0)
        throw new PullRequestGitError(
          'Base and head have no available merge base',
          'missing-merge-base',
        );
      if (mergeBases.length > 1)
        throw new PullRequestGitError(
          'Base and head have multiple merge bases',
          'ambiguous-merge-base',
        );
      const changedFiles = await diffTrees(root, base.treeSha, head.treeSha, signal);
      const complete = changedFiles.length <= maxChangedFiles;
      const bounded = changedFiles.slice(0, maxChangedFiles);
      const gitVersion = normalizeOutput(await runGit(['--version'], root, signal));
      const renameDetectionPolicy = `find-renames=${RENAME_SIMILARITY}`;
      const changedFileFingerprint = sha256(JSON.stringify(changedFiles));
      return Ok({
        baseCommitSha: base.commitSha,
        headCommitSha: head.commitSha,
        baseTreeSha: base.treeSha,
        headTreeSha: head.treeSha,
        mergeBaseSha: mergeBases[0]!,
        changedFiles: bounded,
        gitVersion,
        renameDetectionPolicy,
        changedFileFingerprint,
        requestFingerprint: pullRequestRequestFingerprint(parsed.data),
        complete,
        truncatedAt: complete ? null : maxChangedFiles,
      });
    } catch (error) {
      return Err(
        error instanceof Error ? error : new PullRequestGitError(String(error), 'unavailable'),
      );
    }
  }
  async getCommitParents(
    rootPath: string,
    commitSha: string,
    signal?: AbortSignal,
  ): Promise<Result<readonly string[]>> {
    try {
      const parsedRequest = CommitImpactRequestSchema.safeParse({ commitSha });
      if (!parsedRequest.success)
        throw new CommitGitError(parsedRequest.error.message, 'invalid-request');
      const canonicalRoot = await resolveGitRoot(rootPath, signal);
      const commit = await inspectCommit(canonicalRoot, parsedRequest.data.commitSha, signal);
      return Ok(commit.parentCommits);
    } catch (error) {
      return Err(error instanceof Error ? error : new CommitGitError(String(error), 'unavailable'));
    }
  }

  async getCommitMetadata(
    rootPath: string,
    request: unknown,
    options: { readonly maxChangedFiles?: number } = {},
    signal?: AbortSignal,
  ): Promise<Result<CommitMetadata>> {
    try {
      const parsedRequest = CommitImpactRequestSchema.safeParse(request);
      if (!parsedRequest.success)
        throw new CommitGitError(parsedRequest.error.message, 'invalid-request');
      const maxChangedFiles = options.maxChangedFiles ?? 500;
      if (
        !Number.isInteger(maxChangedFiles) ||
        maxChangedFiles <= 0 ||
        maxChangedFiles > HARD_MAX_CHANGED_FILES
      )
        throw new CommitGitError('Invalid changed-file bound', 'invalid-request');
      if (signal?.aborted) throw new CommitGitError('Commit query cancelled', 'cancelled');

      const canonicalRoot = await resolveGitRoot(rootPath, signal);

      const commit = await inspectCommit(canonicalRoot, parsedRequest.data.commitSha, signal);
      const selectedParent = selectParent(commit.parentCommits, parsedRequest.data.parentSha);
      const parentTreeSha = selectedParent
        ? (await inspectCommit(canonicalRoot, selectedParent, signal)).treeSha
        : null;
      const beforeTree = parentTreeSha ?? EMPTY_TREE_SHA;
      const raw = await runGit(
        [
          '-c',
          'core.quotepath=false',
          'diff-tree',
          '-r',
          '--no-commit-id',
          '--raw',
          '-z',
          `--find-renames=${RENAME_SIMILARITY}`,
          beforeTree,
          commit.treeSha,
        ],
        canonicalRoot,
        signal,
      );
      const numstat = await runGit(
        [
          '-c',
          'core.quotepath=false',
          'diff-tree',
          '-r',
          '--no-commit-id',
          '--numstat',
          '-z',
          `--find-renames=${RENAME_SIMILARITY}`,
          beforeTree,
          commit.treeSha,
        ],
        canonicalRoot,
        signal,
      );
      const binaryPaths = parseBinaryPaths(numstat);
      const changedFiles = parseRawDiff(raw)
        .map((file) => toChangedFile(file, binaryPaths))
        .sort(compareChangedFiles);
      if (changedFiles.length > HARD_MAX_CHANGED_FILES)
        throw new CommitGitError('Commit change output exceeds the hard bound', 'output-limit');
      const complete = changedFiles.length <= maxChangedFiles;
      return Ok({
        commitSha: commit.commitSha,
        treeSha: commit.treeSha,
        parentCommits: commit.parentCommits,
        parentCommitSha: selectedParent,
        parentTreeSha,
        changedFiles: changedFiles.slice(0, maxChangedFiles),
        complete,
        truncatedAt: complete ? null : maxChangedFiles,
      });
    } catch (error) {
      return Err(error instanceof Error ? error : new CommitGitError(String(error), 'unavailable'));
    }
  }
}

async function inspectRangeCommit(
  root: string,
  sha: string,
  side: 'base' | 'head',
  signal?: AbortSignal,
): Promise<{ commitSha: string; treeSha: string; parentCommits: string[] }> {
  try {
    return await inspectCommit(root, sha, signal);
  } catch (error) {
    if (error instanceof CommitGitError && error.code === 'missing-commit')
      throw new PullRequestGitError(
        `Pull request ${side} commit is unavailable: ${sha}`,
        side === 'base' ? 'missing-base' : 'missing-head',
      );
    throw error;
  }
}

async function resolveMergeBases(
  root: string,
  base: string,
  head: string,
  signal?: AbortSignal,
): Promise<string[]> {
  try {
    const output = normalizeOutput(
      await runGit(['merge-base', '--all', '--end-of-options', base, head], root, signal),
    );
    if (!output) return [];
    const values = output.split(/\r?\n/u).filter(Boolean).sort(compareStrings);
    if (!values.every(isFullSha))
      throw new PullRequestGitError('Git returned malformed merge-base metadata', 'unavailable');
    return values;
  } catch (error) {
    if (error instanceof CommitGitError) {
      if (error.code === 'cancelled') throw new PullRequestGitError(error.message, 'cancelled');
      if (error.code === 'output-limit')
        throw new PullRequestGitError(error.message, 'output-limit');
      return [];
    }
    throw error;
  }
}

async function diffTrees(
  root: string,
  baseTree: string,
  headTree: string,
  signal?: AbortSignal,
): Promise<CommitChangedFile[]> {
  try {
    const common = [
      '-c',
      'core.quotepath=false',
      'diff-tree',
      '-r',
      '--no-commit-id',
      '-z',
      `--find-renames=${RENAME_SIMILARITY}`,
    ];
    const raw = await runGit([...common, '--raw', baseTree, headTree], root, signal);
    const numstat = await runGit([...common, '--numstat', baseTree, headTree], root, signal);
    const binaryPaths = parseBinaryPaths(numstat);
    return parseRawDiff(raw)
      .map((file) => toChangedFile(file, binaryPaths))
      .sort(compareChangedFiles);
  } catch (error) {
    if (error instanceof CommitGitError && error.code === 'unavailable')
      throw new PullRequestGitError('Pull request tree objects are unavailable', 'missing-tree');
    throw error;
  }
}

async function resolveGitRoot(rootPath: string, signal?: AbortSignal): Promise<string> {
  const requestedRoot = await realpath(rootPath).catch(() => {
    throw new CommitGitError('Repository root does not exist', 'path-security');
  });
  const gitRoot = normalizeAbsolute(
    await runGit(['rev-parse', '--show-toplevel'], requestedRoot, signal),
  );
  const canonicalRoot = await realpath(gitRoot).catch(() => gitRoot);
  if (comparisonPath(requestedRoot) !== comparisonPath(canonicalRoot))
    throw new CommitGitError(
      'Git root does not match the Project DNA analysis root',
      'path-security',
    );
  const objectFormat = normalizeOutput(
    await runGit(['rev-parse', '--show-object-format'], canonicalRoot, signal),
  );
  if (objectFormat !== 'sha1')
    throw new CommitGitError(
      `Unsupported Git object format: ${objectFormat}`,
      'unsupported-object-format',
    );
  return canonicalRoot;
}

async function inspectCommit(
  root: string,
  requestedSha: string,
  signal?: AbortSignal,
): Promise<{ commitSha: string; treeSha: string; parentCommits: string[] }> {
  let output: string;
  try {
    output = await runGit(
      ['show', '--no-patch', '--format=%H%x00%T%x00%P', requestedSha],
      root,
      signal,
    );
  } catch (error) {
    if (error instanceof CommitGitError && error.code === 'unavailable')
      throw new CommitGitError(`Commit object is unavailable: ${requestedSha}`, 'missing-commit');
    throw error;
  }
  const [commitSha, treeSha, parents = ''] = normalizeOutput(output).split('\0');
  if (commitSha !== requestedSha || !isFullSha(treeSha))
    throw new CommitGitError('Git returned malformed commit metadata', 'invalid-output');
  const parentCommits = parents === '' ? [] : parents.split(' ');
  if (!parentCommits.every(isFullSha))
    throw new CommitGitError('Git returned malformed parent metadata', 'invalid-output');
  return { commitSha, treeSha, parentCommits };
}

function selectParent(parents: readonly string[], requested?: string): string | null {
  if (parents.length === 0) {
    if (requested)
      throw new CommitGitError('Root commits do not have a selectable parent', 'invalid-parent');
    return null;
  }
  if (parents.length === 1) {
    if (requested && requested !== parents[0])
      throw new CommitGitError('Requested SHA is not a direct parent', 'invalid-parent');
    return parents[0]!;
  }
  if (!requested)
    throw new CommitGitError(
      'Merge commits require an explicit direct parent SHA',
      'ambiguous-merge-parent',
    );
  if (!parents.includes(requested))
    throw new CommitGitError('Requested SHA is not a direct parent', 'invalid-parent');
  return requested;
}

function parseRawDiff(output: string): RawChangedFile[] {
  const tokens = output.split('\0');
  const files: RawChangedFile[] = [];
  for (let index = 0; index < tokens.length;) {
    const header = tokens[index++];
    if (!header) continue;
    const match = /^:([0-7]{6}) ([0-7]{6}) ([0-9a-f]{40}) ([0-9a-f]{40}) ([A-Z][0-9]*)$/u.exec(
      header,
    );
    if (!match) throw new CommitGitError('Malformed Git raw diff record', 'invalid-output');
    const firstPath = tokens[index++];
    if (!firstPath || isUnsafeRelativePath(firstPath))
      throw new CommitGitError('Unsafe or missing Git diff path', 'path-security');
    const status = match[5]!;
    if (status.startsWith('R')) {
      const currentPath = tokens[index++];
      if (!currentPath || isUnsafeRelativePath(currentPath))
        throw new CommitGitError('Unsafe or missing Git rename path', 'path-security');
      files.push({
        oldMode: match[1]!,
        newMode: match[2]!,
        oldBlobSha: match[3]!,
        newBlobSha: match[4]!,
        status,
        path: normalizeRelative(currentPath),
        previousPath: normalizeRelative(firstPath),
      });
    } else {
      files.push({
        oldMode: match[1]!,
        newMode: match[2]!,
        oldBlobSha: match[3]!,
        newBlobSha: match[4]!,
        status,
        path: normalizeRelative(firstPath),
      });
    }
  }
  return files;
}

function parseBinaryPaths(output: string): Set<string> {
  const tokens = output.split('\0');
  const binary = new Set<string>();
  for (let index = 0; index < tokens.length;) {
    const record = tokens[index++];
    if (!record) continue;
    const match = /^(\d+|-)\t(\d+|-)\t(.*)$/su.exec(record);
    if (!match) throw new CommitGitError('Malformed Git numstat record', 'invalid-output');
    if (match[3] === '') {
      const previousPath = tokens[index++];
      const currentPath = tokens[index++];
      if (!previousPath || !currentPath)
        throw new CommitGitError('Malformed Git numstat rename', 'invalid-output');
      if (match[1] === '-' || match[2] === '-') binary.add(normalizeRelative(currentPath));
    } else if (match[1] === '-' || match[2] === '-') {
      binary.add(normalizeRelative(match[3]!));
    }
  }
  return binary;
}

function toChangedFile(file: RawChangedFile, binaryPaths: ReadonlySet<string>): CommitChangedFile {
  const gitlink = file.oldMode === '160000' || file.newMode === '160000';
  const symlink = file.oldMode === '120000' || file.newMode === '120000';
  const binary = binaryPaths.has(file.path);
  const contentKind: CommitFileContentKind = gitlink
    ? 'submodule'
    : symlink
      ? 'symlink'
      : binary
        ? 'binary'
        : 'text';
  const status = file.status[0];
  const kind =
    status === 'A'
      ? 'added'
      : status === 'D'
        ? 'deleted'
        : status === 'R'
          ? 'renamed'
          : status === 'T'
            ? 'type-changed'
            : status === 'M'
              ? 'modified'
              : null;
  if (kind === null)
    throw new CommitGitError(`Unsupported Git diff status: ${file.status}`, 'invalid-output');
  return CommitChangedFileSchema.parse({
    kind,
    path: file.path,
    ...(file.previousPath ? { previousPath: file.previousPath } : {}),
    oldBlobSha: isZeroSha(file.oldBlobSha) ? null : file.oldBlobSha,
    newBlobSha: isZeroSha(file.newBlobSha) ? null : file.newBlobSha,
    oldMode: file.oldMode === '000000' ? null : file.oldMode,
    newMode: file.newMode === '000000' ? null : file.newMode,
    contentKind,
    binary,
    gitlink,
  });
}

function compareChangedFiles(left: CommitChangedFile, right: CommitChangedFile): number {
  return (
    compareStrings(left.path, right.path) ||
    compareStrings(left.previousPath ?? '', right.previousPath ?? '') ||
    compareStrings(left.kind, right.kind) ||
    compareStrings(left.oldBlobSha ?? '', right.oldBlobSha ?? '') ||
    compareStrings(left.newBlobSha ?? '', right.newBlobSha ?? '')
  );
}

function runGit(args: readonly string[], cwd: string, signal?: AbortSignal): Promise<string> {
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
      () => finish(new CommitGitError('Git command timed out', 'timeout')),
      COMMAND_TIMEOUT_MS,
    );
    const abort = () => finish(new CommitGitError('Commit query cancelled', 'cancelled'));
    signal?.addEventListener('abort', abort, { once: true });
    const append = (target: 'stdout' | 'stderr', chunk: Buffer): void => {
      if (target === 'stdout') stdout = Buffer.concat([stdout, chunk]);
      else stderr = Buffer.concat([stderr, chunk]);
      if (stdout.length + stderr.length > MAX_OUTPUT_BYTES)
        finish(new CommitGitError('Git output exceeded the bounded limit', 'output-limit'));
    };
    child.stdout.on('data', (chunk: Buffer) => append('stdout', chunk));
    child.stderr.on('data', (chunk: Buffer) => append('stderr', chunk));
    child.once('error', (error) =>
      finish(new CommitGitError(`Git unavailable: ${error.message}`, 'unavailable')),
    );
    child.once('close', (code) => {
      if (settled) return;
      if (code === 0) finish(null, stdout.toString('utf8'));
      else if (args.includes('--show-toplevel'))
        finish(new CommitGitError('Path is not a Git repository', 'not-a-repository'));
      else
        finish(
          new CommitGitError(
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
  } else child.kill('SIGKILL');
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
function isFullSha(value: string | undefined): value is string {
  return value !== undefined && /^[0-9a-f]{40}$/u.test(value);
}
function isZeroSha(value: string): boolean {
  return /^0{40}$/u.test(value);
}
function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
