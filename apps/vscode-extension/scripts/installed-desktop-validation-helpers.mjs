import { closeSync, existsSync, openSync, readdirSync, statSync, writeSync } from 'node:fs';
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
    return { cli, runtime };
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
    return { cli, runtime };
  }
  const executable = findPath(clientRoot, (candidate) => path.basename(candidate) === 'Code.exe');
  assert(executable !== undefined, 'official VS Code executable Code.exe is missing');
  return { cli: executable, runtime: executable };
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
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('aborted');
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
