import { spawn } from 'node:child_process';
import {
  closeSync,
  copyFileSync,
  existsSync,
  openSync,
  readdirSync,
  statSync,
  writeSync,
} from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';

export function findClientExecutables({ clientRoot, expectedPlatform }) {
  if (expectedPlatform === 'darwin') {
    const application = findPath(
      clientRoot,
      (candidate) => path.basename(candidate) === 'Visual Studio Code.app',
    );
    assert(application !== undefined, 'official VS Code application bundle is missing');
    const cli = path.join(application, 'Contents', 'Resources', 'app', 'bin', 'code');
    const runtime = path.join(application, 'Contents', 'MacOS', 'Code');
    assert(existsSync(cli), `official VS Code CLI is missing: ${cli}`);
    assert(existsSync(runtime), `official VS Code runtime is missing: ${runtime}`);
    return { cli: directCli(cli), runtime };
  }
  if (expectedPlatform === 'linux') {
    const cli = findPath(
      clientRoot,
      (candidate) =>
        path.basename(candidate) === 'code' && path.basename(path.dirname(candidate)) === 'bin',
    );
    assert(cli !== undefined, 'official VS Code CLI is missing');
    const runtime = path.join(path.dirname(path.dirname(cli)), 'code');
    assert(existsSync(runtime), `official VS Code runtime is missing: ${runtime}`);
    return { cli: directCli(cli), runtime };
  }
  const wrapper = findPath(
    clientRoot,
    (candidate) =>
      path.basename(candidate).toLowerCase() === 'code.cmd' &&
      path.basename(path.dirname(candidate)).toLowerCase() === 'bin',
  );
  assert(wrapper !== undefined, 'official VS Code CLI wrapper bin\\code.cmd is missing');
  const applicationRoot = path.dirname(path.dirname(wrapper));
  const runtime = path.join(applicationRoot, 'Code.exe');
  const cliScript = findPath(
    applicationRoot,
    (candidate) =>
      path.basename(candidate) === 'cli.js' &&
      path.basename(path.dirname(candidate)) === 'out' &&
      path.basename(path.dirname(path.dirname(candidate))) === 'app' &&
      path.basename(path.dirname(path.dirname(path.dirname(candidate)))) === 'resources',
  );
  assert(existsSync(runtime), `official VS Code runtime is missing: ${runtime}`);
  assert(
    cliScript !== undefined,
    'official VS Code CLI script resources\\app\\out\\cli.js is missing',
  );
  return {
    cli: {
      executable: runtime,
      prefixArguments: [cliScript],
      workingDirectory: applicationRoot,
      environment: { ELECTRON_RUN_AS_NODE: '1', VSCODE_DEV: '' },
      source: wrapper,
    },
    runtime,
  };
}

export function createClientCommand(cli, args) {
  return {
    command: cli.executable,
    args: [...cli.prefixArguments, ...args],
    cwd: cli.workingDirectory,
    environment: { ...cli.environment },
  };
}

export function captureDriverResult({ resultPath, failureLogDirectory, result }) {
  const destination = path.join(failureLogDirectory, 'installed-extension-host.json');
  const relative = path.relative(failureLogDirectory, destination);
  assert(
    relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative),
    `driver result destination must be inside ${failureLogDirectory}`,
  );
  if (!existsSync(resultPath) || !statSync(resultPath).isFile()) return undefined;
  copyFileSync(resultPath, destination);
  return { destination, result };
}

export function formatDriverFailure(result) {
  if (result?.success !== false) return undefined;
  const error = typeof result.error === 'string' ? result.error : 'unavailable';
  const stack = typeof result.stack === 'string' ? result.stack : 'unavailable';
  return `driver result: expected true, received false\nDriver error: ${error}\nDriver stack:\n${stack}`;
}

export async function runCommand(
  command,
  args,
  { cwd, signal, environment = {}, logger = () => {}, label = 'command' },
) {
  throwIfAborted(signal);
  logger(
    `process=${label} status=creating executable=${JSON.stringify(command)} cwd=${JSON.stringify(cwd ?? process.cwd())} arguments=${JSON.stringify(args)} environment=${JSON.stringify(environment)}`,
  );
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...environment },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    logger(`process=${label} status=created pid=${child.pid ?? 'unavailable'}`);
    let stdout = '';
    let stderr = '';
    let settled = false;
    let aborting = false;
    const logOutput = () => {
      logger(
        `process=${label} status=output stdout=${JSON.stringify(stdout)} stderr=${JSON.stringify(stderr)}`,
      );
    };
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve(value);
    };
    const onAbort = () => {
      if (settled || aborting) return;
      aborting = true;
      logger(`process=${label} status=abort reason=${JSON.stringify(abortReason(signal).message)}`);
      void terminateCommandProcess(child, { label, logger }).finally(() =>
        finish(abortReason(signal)),
      );
    };
    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.once('error', (error) => {
      logger(`process=${label} status=error message=${JSON.stringify(error.message)}`);
      if (!aborting) finish(error);
    });
    child.once('exit', (code, exitSignal) => {
      logOutput();
      logger(`process=${label} status=exit code=${code} signal=${exitSignal ?? 'none'}`);
      if (aborting) return;
      if (code === 0) finish(undefined, { stdout, stderr });
      else
        finish(
          new Error(
            `${command} ${args.join(' ')} failed: code=${code} signal=${exitSignal}\n${stdout}\n${stderr}`,
          ),
        );
    });
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export async function downloadFile(
  url,
  destination,
  {
    signal,
    fetchImpl = fetch,
    maxAttempts = 5,
    delayFn = (milliseconds) => delay(milliseconds, signal),
    logger = () => {},
  },
) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    throwIfAborted(signal);
    const existingSize = existsSync(destination) ? statSync(destination).size : 0;
    const headers = { 'Accept-Encoding': 'identity' };
    if (existingSize > 0) headers.Range = `bytes=${existingSize}-`;
    logger(`download attempt=${attempt}/${maxAttempts} offset=${existingSize}`);
    let expectedSize;
    try {
      const response = await fetchImpl(url, { redirect: 'follow', headers, signal });
      assert(response.ok, `download failed with HTTP ${response.status}: ${url}`);
      assert(response.body !== null, `download response had no body: ${url}`);
      const contentRange = parseContentRange(response.headers.get('content-range'));
      if (response.status === 206) {
        assert(contentRange !== undefined, 'range response did not include Content-Range');
        assert(
          contentRange.start === existingSize,
          'range response started at an unexpected offset',
        );
      }
      const resume =
        existingSize > 0 && response.status === 206 && contentRange?.start === existingSize;
      if (existingSize > 0 && !resume) logger('download server did not honor range; restarting');
      const offset = resume ? existingSize : 0;
      expectedSize = contentRange?.total ?? contentLength(response, offset);
      await writeResponseBody(response.body, destination, offset, signal);
      const actualSize = statSync(destination).size;
      if (expectedSize !== undefined && actualSize !== expectedSize) {
        throw new Error(
          `download incomplete: expected ${expectedSize} bytes, received ${actualSize}`,
        );
      }
      logger(`download complete bytes=${actualSize}`);
      return;
    } catch (error) {
      lastError = error;
      const actualSize = existsSync(destination) ? statSync(destination).size : 0;
      if (expectedSize !== undefined && actualSize === expectedSize) {
        logger(`download complete bytes=${actualSize} after transport closed`);
        return;
      }
      logger(`download attempt=${attempt}/${maxAttempts} failed: ${error.message}`);
      if (signal?.aborted || attempt === maxAttempts) break;
      await delayFn(Math.min(2 ** (attempt - 1), 8) * 1_000);
    }
  }
  throw new Error(`download failed after ${maxAttempts} attempts: ${lastError?.message ?? url}`, {
    cause: lastError,
  });
}

export async function runStage(name, { signal, timeoutMs, logger = () => {} }, operation) {
  const controller = new AbortController();
  const stageSignal = AbortSignal.any([signal, controller.signal]);
  const timeout = setTimeout(
    () => controller.abort(new Error(`stage "${name}" exceeded ${timeoutMs} ms`)),
    timeoutMs,
  );
  timeout.unref?.();
  logger(`stage=${name} status=start timeoutMs=${timeoutMs}`);
  try {
    const result = await operation(stageSignal);
    logger(`stage=${name} status=complete`);
    return result;
  } catch (error) {
    logger(`stage=${name} status=failed error=${error.message}`);
    throw new Error(`desktop validation failed during ${name}: ${error.message}`, {
      cause: error,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function runWithCleanup(operation, cleanup) {
  let failure;
  try {
    return await operation();
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    await cleanup(failure);
  }
}

function contentLength(response, offset) {
  const value = response.headers.get('content-length');
  if (value === null) return undefined;
  const length = Number(value);
  return Number.isSafeInteger(length) ? offset + length : undefined;
}

function directCli(executable) {
  return {
    executable,
    prefixArguments: [],
    workingDirectory: undefined,
    environment: {},
    source: executable,
  };
}

async function terminateCommandProcess(child, { label, logger }) {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) {
    logger(`process=${label} cleanup=skipped reason=already-exited`);
    return;
  }
  logger(`process=${label} cleanup=start pid=${child.pid} platform=${process.platform}`);
  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      const taskkill = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      taskkill.stdout?.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      taskkill.stderr?.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      taskkill.once('exit', (code, signal) => {
        logger(
          `process=${label} cleanup=complete code=${code} signal=${signal ?? 'none'} stdout=${JSON.stringify(stdout)} stderr=${JSON.stringify(stderr)}`,
        );
        resolve();
      });
      taskkill.once('error', (error) => {
        logger(`process=${label} cleanup=failed error=${JSON.stringify(error.message)}`);
        resolve();
      });
    });
    return;
  }
  const killed = child.kill('SIGKILL');
  logger(`process=${label} cleanup=complete signal=SIGKILL killed=${killed}`);
}

async function writeResponseBody(body, destination, offset, signal) {
  const descriptor = openSync(destination, offset > 0 ? 'a' : 'w');
  try {
    for await (const chunk of Readable.fromWeb(body)) {
      throwIfAborted(signal);
      let written = 0;
      while (written < chunk.length) {
        written += writeSync(descriptor, chunk, written);
      }
    }
  } finally {
    closeSync(descriptor);
  }
}

function parseContentRange(value) {
  const match = /^bytes (\d+)-(\d+)\/(\d+|\*)$/u.exec(value ?? '');
  if (!match || match[3] === '*') return undefined;
  return { start: Number(match[1]), end: Number(match[2]), total: Number(match[3]) };
}

function findPath(root, predicate) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const candidate = path.join(root, entry.name);
    if (predicate(candidate)) return candidate;
    if (entry.isDirectory()) {
      const nested = findPath(candidate, predicate);
      if (nested) return nested;
    }
  }
  return undefined;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortReason(signal);
}

function abortReason(signal) {
  return signal?.reason instanceof Error ? signal.reason : new Error('aborted');
}

function delay(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'));
      },
      { once: true },
    );
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
