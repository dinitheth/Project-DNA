import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout } from 'node:timers';
import { afterEach, describe, expect, it } from 'vitest';
import {
  captureDriverResult,
  createClientCommand,
  downloadFile,
  formatDriverFailure,
  findClientExecutables,
  runCommand,
  runStage,
  runWithCleanup,
} from '../../scripts/installed-desktop-validation-helpers.mjs';

const { AbortController, ReadableStream, Response, TextEncoder } = globalThis;
const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('installed desktop validation helpers', () => {
  it('captures failed driver JSON byte-for-byte and surfaces its error and stack', () => {
    const root = temporaryDirectory();
    const resultPath = path.join(root, 'user-data', 'installed-extension-host.json');
    const failureLogDirectory = path.join(root, 'logs');
    mkdirSync(path.dirname(resultPath), { recursive: true });
    mkdirSync(failureLogDirectory, { recursive: true });
    const rawResult =
      '{\n  "success": false,\n  "error": "workspace failed",\n  "stack": "Error: workspace failed\\n at driver"\n}\n';
    writeFileSync(resultPath, rawResult, 'utf8');
    const result = JSON.parse(rawResult);

    const captured = captureDriverResult({ resultPath, failureLogDirectory, result });

    expect(readFileSync(captured.destination, 'utf8')).toBe(rawResult);
    expect(formatDriverFailure(captured.result)).toContain('Driver error: workspace failed');
    expect(formatDriverFailure(captured.result)).toContain(
      'Driver stack:\nError: workspace failed',
    );
  });

  it('leaves successful driver results unchanged and skips missing results', () => {
    const root = temporaryDirectory();
    const failureLogDirectory = path.join(root, 'logs');
    const resultPath = path.join(root, 'installed-extension-host.json');
    const result = { success: true, vscodeVersion: '1.133.0' };
    mkdirSync(failureLogDirectory, { recursive: true });
    writeFileSync(resultPath, JSON.stringify(result), 'utf8');

    const captured = captureDriverResult({ resultPath, failureLogDirectory, result });

    expect(captured.result).toEqual(result);
    expect(formatDriverFailure(result)).toBeUndefined();
    expect(readFileSync(captured.destination, 'utf8')).toBe(JSON.stringify(result));
    expect(
      captureDriverResult({
        resultPath: path.join(root, 'missing.json'),
        failureLogDirectory,
        result,
      }),
    ).toBeUndefined();
  });

  it('keeps failure capture bounded to its logs directory', () => {
    const root = temporaryDirectory();
    const resultPath = path.join(root, 'result.json');
    const failureLogDirectory = path.join(root, 'logs');
    const unrelatedPath = path.join(root, 'unrelated.txt');
    mkdirSync(failureLogDirectory, { recursive: true });
    writeFileSync(resultPath, '{"success":false}', 'utf8');
    writeFileSync(unrelatedPath, 'untouched', 'utf8');

    const captured = captureDriverResult({
      resultPath,
      failureLogDirectory,
      result: { success: false },
    });

    expect(path.dirname(captured.destination)).toBe(failureLogDirectory);
    expect(readFileSync(unrelatedPath, 'utf8')).toBe('untouched');
    expect(readdirSync(failureLogDirectory)).toEqual(['installed-extension-host.json']);
  });

  it.each(['darwin-x64', 'darwin-arm64'])(
    'discovers the official macOS Code executable for %s',
    () => {
      const root = temporaryDirectory();
      const application = path.join(root, 'Visual Studio Code.app');
      const cli = path.join(application, 'Contents', 'Resources', 'app', 'bin', 'code');
      const runtime = path.join(application, 'Contents', 'MacOS', 'Code');
      writeFixture(cli);
      writeFixture(runtime);
      writeFixture(
        path.join(
          application,
          'Contents',
          'Frameworks',
          'Code Helper.app',
          'Contents',
          'MacOS',
          'Code Helper',
        ),
      );

      expect(findClientExecutables({ clientRoot: root, expectedPlatform: 'darwin' })).toEqual({
        cli: {
          executable: cli,
          prefixArguments: [],
          workingDirectory: undefined,
          environment: {},
          source: cli,
        },
        runtime,
      });
    },
  );

  it('uses the official Windows CLI bootstrap while preserving Code.exe for GUI launch', () => {
    const root = temporaryDirectory();
    const application = path.join(root, 'VSCode-win32-x64');
    const wrapper = path.join(application, 'bin', 'code.cmd');
    const runtime = path.join(application, 'Code.exe');
    const cliScript = path.join(application, 'a5b5009513', 'resources', 'app', 'out', 'cli.js');
    writeFixture(wrapper);
    writeFixture(runtime);
    writeFixture(cliScript);
    writeFixture(path.join(application, 'resources', 'app', 'node_modules', 'helper', 'Code.exe'));

    const executables = findClientExecutables({ clientRoot: root, expectedPlatform: 'win32' });

    expect(executables.runtime).toBe(runtime);
    expect(executables.cli).toEqual({
      executable: runtime,
      prefixArguments: [cliScript],
      workingDirectory: application,
      environment: { ELECTRON_RUN_AS_NODE: '1', VSCODE_DEV: '' },
      source: wrapper,
    });
    expect(createClientCommand(executables.cli, ['--version'])).toEqual({
      command: runtime,
      args: [cliScript, '--version'],
      cwd: application,
      environment: { ELECTRON_RUN_AS_NODE: '1', VSCODE_DEV: '' },
    });
  });

  it('records process creation, environment, output, and exit diagnostics', async () => {
    const markers = [];
    const workingDirectory = temporaryDirectory();
    const result = await runCommand(
      globalThis.process.execPath,
      [
        '-e',
        "process.stdout.write(process.env.PROJECT_DNA_DIAGNOSTIC); process.stderr.write('stderr');",
      ],
      {
        cwd: workingDirectory,
        signal: new AbortController().signal,
        environment: { PROJECT_DNA_DIAGNOSTIC: 'stdout' },
        logger: (line) => markers.push(line),
        label: 'official-version',
      },
    );

    expect(result).toEqual({ stdout: 'stdout', stderr: 'stderr' });
    expect(markers.join('\n')).toContain('process=official-version status=creating');
    expect(markers.join('\n')).toContain(`cwd=${JSON.stringify(workingDirectory)}`);
    expect(markers.join('\n')).toContain('environment={"PROJECT_DNA_DIAGNOSTIC":"stdout"}');
    expect(markers.join('\n')).toContain('process=official-version status=created pid=');
    expect(markers.join('\n')).toContain(
      'process=official-version status=output stdout="stdout" stderr="stderr"',
    );
    expect(markers.join('\n')).toContain('process=official-version status=exit code=0 signal=none');
  });

  it('records timeout and process cleanup diagnostics', async () => {
    const markers = [];
    const controller = new AbortController();
    const command = runCommand(
      globalThis.process.execPath,
      ['-e', 'setInterval(() => {}, 1_000);'],
      {
        signal: controller.signal,
        logger: (line) => markers.push(line),
        label: 'official-version',
      },
    );
    setTimeout(() => controller.abort(new Error('official version verification timed out')), 20);

    await expect(command).rejects.toThrow('official version verification timed out');
    expect(markers.join('\n')).toContain(
      'process=official-version status=abort reason="official version verification timed out"',
    );
    expect(markers.join('\n')).toContain('process=official-version cleanup=start pid=');
    expect(markers.join('\n')).toContain('process=official-version cleanup=complete');
  });

  it('resumes a partial official archive download from the verified byte offset', async () => {
    const destination = path.join(temporaryDirectory(), 'archive.zip');
    const ranges = [];
    let attempt = 0;
    const fetchImpl = async (_url, options) => {
      ranges.push(options.headers.Range);
      attempt += 1;
      if (attempt === 1) return brokenResponse('abc', { 'content-length': '6' });
      return new Response('def', {
        status: 206,
        headers: { 'content-range': 'bytes 3-5/6', 'content-length': '3' },
      });
    };

    await downloadFile('https://example.invalid/archive.zip', destination, {
      signal: new AbortController().signal,
      fetchImpl,
      maxAttempts: 2,
      delayFn: async () => {},
    });

    expect(ranges).toEqual([undefined, 'bytes=3-']);
    expect(readFileSync(destination, 'utf8')).toBe('abcdef');
  });

  it('reports a bounded failure while preserving resumable partial bytes', async () => {
    const destination = path.join(temporaryDirectory(), 'archive.zip');
    const ranges = [];
    const fetchImpl = async (_url, options) => {
      ranges.push(options.headers.Range);
      const offset = options.headers.Range === undefined ? 0 : 3;
      return brokenResponse(
        offset === 0 ? 'abc' : 'd',
        offset === 0
          ? { 'content-length': '6' }
          : { 'content-range': 'bytes 3-5/6', 'content-length': '3' },
        offset === 0 ? 200 : 206,
      );
    };

    await expect(
      downloadFile('https://example.invalid/archive.zip', destination, {
        signal: new AbortController().signal,
        fetchImpl,
        maxAttempts: 2,
        delayFn: async () => {},
      }),
    ).rejects.toThrow('download failed after 2 attempts');

    expect(ranges).toEqual([undefined, 'bytes=3-']);
    expect(readFileSync(destination, 'utf8')).toBe('abcd');
  });

  it('accepts a completed archive when the transport closes after the final byte', async () => {
    const destination = path.join(temporaryDirectory(), 'archive.zip');
    const fetchImpl = async () => brokenResponse('abcdef', { 'content-length': '6' });

    await downloadFile('https://example.invalid/archive.zip', destination, {
      signal: new AbortController().signal,
      fetchImpl,
      maxAttempts: 1,
      delayFn: async () => {},
    });

    expect(readFileSync(destination, 'utf8')).toBe('abcdef');
  });

  it('restarts safely when the server ignores a resume range', async () => {
    const destination = path.join(temporaryDirectory(), 'archive.zip');
    writeFileSync(destination, 'abc', 'utf8');
    const ranges = [];
    const markers = [];
    const fetchImpl = async (_url, options) => {
      ranges.push(options.headers.Range);
      return new Response('abcdef', {
        status: 200,
        headers: { 'content-length': '6' },
      });
    };

    await downloadFile('https://example.invalid/archive.zip', destination, {
      signal: new AbortController().signal,
      fetchImpl,
      maxAttempts: 1,
      delayFn: async () => {},
      logger: (line) => markers.push(line),
    });

    expect(ranges).toEqual(['bytes=3-']);
    expect(markers).toContain('download server did not honor range; restarting');
    expect(readFileSync(destination, 'utf8')).toBe('abcdef');
  });

  it('identifies the exact pre-launch stage when its deadline expires', async () => {
    const markers = [];
    await expect(
      runStage(
        'extension listing',
        {
          signal: new AbortController().signal,
          timeoutMs: 10,
          logger: (line) => markers.push(line),
        },
        (signal) =>
          new Promise((_, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          }),
      ),
    ).rejects.toThrow(
      'desktop validation failed during extension listing: stage "extension listing" exceeded 10 ms',
    );
    expect(markers).toEqual([
      'stage=extension listing status=start timeoutMs=10',
      'stage=extension listing status=failed error=stage "extension listing" exceeded 10 ms',
    ]);
  });

  it.each(['official archive extraction', 'extension installation'])(
    'cleans up after %s fails',
    async (stage) => {
      let cleanupCalls = 0;
      await expect(
        runWithCleanup(
          () =>
            runStage(
              stage,
              { signal: new AbortController().signal, timeoutMs: 1_000 },
              async () => {
                throw new Error('injected failure');
              },
            ),
          async () => {
            cleanupCalls += 1;
          },
        ),
      ).rejects.toThrow(`desktop validation failed during ${stage}: injected failure`);
      expect(cleanupCalls).toBe(1);
    },
  );
});

function temporaryDirectory() {
  const directory = mkdtempSync(path.join(tmpdir(), 'project-dna-desktop-validator-'));
  temporaryDirectories.push(directory);
  return directory;
}

function writeFixture(filePath) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, 'fixture', 'utf8');
}

function brokenResponse(chunk, headers, status = 200) {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(chunk));
      setTimeout(() => controller.error(new Error('injected socket failure')), 5);
    },
  });
  return new Response(body, { status, headers });
}
