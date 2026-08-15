import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  appendFileSync,
  cpSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VSCODE_VERSION = process.env.PROJECT_DNA_EXPECTED_VSCODE_VERSION ?? '1.132.0';
const VSCODE_SERVER_COMMIT =
  process.env.PROJECT_DNA_EXPECTED_VSCODE_SERVER_COMMIT ??
  'df53daabb18cd157bdb08c7f01c34df936cf12f4';
const VSCODE_SERVER_URL = `https://update.code.visualstudio.com/${VSCODE_VERSION}/server-linux-x64-web/stable`;
const VSCODE_SERVER_SHA256 =
  process.env.PROJECT_DNA_EXPECTED_VSCODE_SERVER_SHA256 ??
  'a49c72b8d9e47faceef53e366c65af1be159bf4818dcb77579241af28de0a7d6';
const HARD_TIMEOUT_MS = 12 * 60 * 1000;
const PROJECT_EXTENSION_ID = 'project-dna.vscode-extension';
const DRIVER_EXTENSION_ID = 'project-dna-tests.project-dna-installed-vsix-driver';
const NATIVE_BINDING = 'native/linux-x64/node-abi137/better_sqlite3.node';
const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(scriptRoot, '..');
const driverRoot = path.join(extensionRoot, 'test', 'installed-vsix-driver');
const require = createRequire(import.meta.url);
const vsceExecutable = require.resolve('@vscode/vsce/vsce');

await main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  assert(process.platform === 'linux', 'installed VSIX server validation requires Linux');
  assert(process.arch === 'x64', 'installed VSIX server validation requires x64');
  const runnerTemp = realpathSync(requiredEnvironment('RUNNER_TEMP'));
  const repositoryWorkspace = realpathSync(requiredEnvironment('GITHUB_WORKSPACE'));
  const validationRoot = path.join(runnerTemp, 'project-dna-installed-server');
  assertPathInside(validationRoot, runnerTemp, 'validation root');
  assertPathOutside(validationRoot, repositoryWorkspace, 'validation root');
  rmSync(validationRoot, { recursive: true, force: true });

  const paths = createPaths(validationRoot);
  for (const directory of [
    paths.downloads,
    paths.serverData,
    paths.extensions,
    paths.workspace,
    paths.browserProfile,
    paths.results,
    paths.logs,
  ]) {
    mkdirSync(directory, { recursive: true });
  }
  createFixtureWorkspace(paths.workspace);

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error(`installed VSIX validation exceeded ${HARD_TIMEOUT_MS} ms`));
  }, HARD_TIMEOUT_MS);
  timeout.unref();
  const resources = { browserContext: undefined, server: undefined, serverOutput: undefined };
  let failure;
  try {
    await runValidation({
      paths,
      resources,
      repositoryWorkspace,
      signal: controller.signal,
    });
  } catch (error) {
    failure = error;
    if (resources.serverOutput) {
      console.error(`VS Code Server output before failure:\n${resources.serverOutput.read()}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    controller.abort(new Error('installed VSIX validation cleanup'));
    await cleanup(resources);
    if (failure) collectFailureLogs(paths);
  }
}

async function runValidation({ paths, resources, repositoryWorkspace, signal }) {
  const vsixPath = path.resolve(
    extensionRoot,
    process.env.VSIX_PATH ?? path.join('release', 'project-dna-a.vsix'),
  );
  const integrityPath = path.resolve(
    extensionRoot,
    process.env.INTEGRITY_PATH ?? path.join('release', 'integrity.json'),
  );
  assert(
    path.basename(vsixPath) === 'project-dna-a.vsix',
    'canonical project-dna-a.vsix is required',
  );
  assert(existsSync(vsixPath), `canonical VSIX is missing: ${vsixPath}`);
  assert(existsSync(integrityPath), `integrity manifest is missing: ${integrityPath}`);
  const integrity = await verifyVsixIntegrity({
    vsixPath,
    integrityPath,
    extractionRoot: paths.integrityExtraction,
    signal,
  });
  const binding = integrity.files.find((file) => file.path === NATIVE_BINDING);
  assert(binding !== undefined, `integrity manifest is missing ${NATIVE_BINDING}`);

  await downloadFile(VSCODE_SERVER_URL, paths.serverArchive, signal);
  assertEqual(await sha256(paths.serverArchive), VSCODE_SERVER_SHA256, 'VS Code Server SHA-256');
  await runCommand('tar', ['-xzf', paths.serverArchive, '-C', paths.downloads], {
    signal,
  });
  const serverRoot = path.join(paths.downloads, 'vscode-server-linux-x64-web');
  const serverExecutable = path.join(serverRoot, 'bin', 'code-server');
  assert(
    existsSync(serverExecutable),
    `official VS Code Server executable is missing: ${serverExecutable}`,
  );
  const version = await runCommand(serverExecutable, ['--version'], { signal });
  const versionLines = version.stdout.split(/\r?\n/u).filter(Boolean);
  assertEqual(versionLines[0], VSCODE_VERSION, 'official VS Code Server version');
  assert(
    versionLines.includes(VSCODE_SERVER_COMMIT),
    `official VS Code Server commit is not ${VSCODE_SERVER_COMMIT}`,
  );

  await createDriverVsix(paths.driverVsix, signal);
  for (const extension of [vsixPath, paths.driverVsix]) {
    await runCommand(
      serverExecutable,
      [
        '--install-extension',
        extension,
        '--force',
        '--extensions-dir',
        paths.extensions,
        '--server-data-dir',
        paths.serverData,
        '--accept-server-license-terms',
      ],
      { signal },
    );
  }
  await verifyInstalledExtensions(serverExecutable, paths, signal);

  const token = randomBytes(32).toString('hex');
  writeFileSync(paths.token, `${token}\n`, { encoding: 'utf8', mode: 0o600 });
  const serverEnvironment = {
    ...process.env,
    PROJECT_DNA_INSTALLED_TEST_RESULT: paths.result,
    PROJECT_DNA_EXPECTED_EXTENSIONS_DIR: paths.extensions,
    PROJECT_DNA_GITHUB_WORKSPACE: repositoryWorkspace,
    PROJECT_DNA_FIXTURE_WORKSPACE: paths.workspace,
    PROJECT_DNA_BINDING_SHA256: binding.sha256,
  };
  const server = spawn(
    serverExecutable,
    [
      '--start-server',
      '--host',
      '127.0.0.1',
      '--port',
      '0',
      '--connection-token-file',
      paths.token,
      '--extensions-dir',
      paths.extensions,
      '--server-data-dir',
      paths.serverData,
      '--default-folder',
      paths.workspace,
      '--accept-server-license-terms',
    ],
    {
      cwd: paths.validationRoot,
      detached: true,
      env: serverEnvironment,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  resources.server = server;
  resources.serverOutput = captureServerOutput(server, paths.serverLog);
  const startupUrl = await waitForServerWebUrl(server, resources.serverOutput, signal);
  const workbenchUrl = new URL(startupUrl);
  assertEqual(workbenchUrl.protocol, 'http:', 'VS Code Server web protocol');
  assert(
    workbenchUrl.hostname === 'localhost' || workbenchUrl.hostname === '127.0.0.1',
    `VS Code Server web host must be loopback: ${workbenchUrl.hostname}`,
  );
  assertEqual(workbenchUrl.searchParams.get('tkn'), token, 'VS Code Server connection token');
  workbenchUrl.hostname = '127.0.0.1';

  const { chromium } = await import('playwright');
  throwIfAborted(signal);
  const browserContext = await chromium.launchPersistentContext(paths.browserProfile, {
    headless: true,
    timeout: 60_000,
  });
  resources.browserContext = browserContext;
  const page = browserContext.pages()[0] ?? (await browserContext.newPage());
  page.on('console', (message) =>
    appendLog(paths.browserLog, `[console:${message.type()}] ${message.text()}`),
  );
  page.on('pageerror', (error) =>
    appendLog(paths.browserLog, `[pageerror] ${error.stack ?? error.message}`),
  );
  page.on('requestfailed', (request) =>
    appendLog(
      paths.browserLog,
      `[requestfailed] ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`,
    ),
  );
  const response = await page.goto(workbenchUrl.href, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await logWorkbenchResponse({
    response,
    requestedUrl: workbenchUrl.href,
    startupUrl,
    logPath: paths.browserLog,
  });
  assert(response?.ok() === true, `VS Code Server workbench returned HTTP ${response?.status()}`);

  const result = await waitForResult(paths.result, signal, server);
  validateResult(result, {
    repositoryWorkspace,
    extensionsDirectory: paths.extensions,
    serverDataDirectory: paths.serverData,
    fixtureWorkspace: paths.workspace,
    bindingSha256: binding.sha256,
  });
  console.log(JSON.stringify(result, null, 2));
}

function createPaths(validationRoot) {
  const downloads = path.join(validationRoot, 'downloads');
  const serverData = path.join(validationRoot, 'server-data');
  const results = path.join(validationRoot, 'results');
  const logs = path.join(validationRoot, 'logs');
  return {
    validationRoot,
    downloads,
    serverData,
    extensions: path.join(validationRoot, 'extensions'),
    workspace: path.join(validationRoot, 'workspace'),
    browserProfile: path.join(validationRoot, 'browser-profile'),
    results,
    logs,
    integrityExtraction: path.join(validationRoot, 'integrity-extracted'),
    serverArchive: path.join(downloads, `vscode-server-linux-x64-web-${VSCODE_VERSION}.tar.gz`),
    driverVsix: path.join(downloads, 'project-dna-installed-vsix-driver.vsix'),
    token: path.join(validationRoot, 'connection-token'),
    result: path.join(
      serverData,
      'data',
      'User',
      'globalStorage',
      DRIVER_EXTENSION_ID,
      'installed-extension-host.json',
    ),
    extensionListLog: path.join(logs, 'installed-extensions.txt'),
    serverLog: path.join(logs, 'server.log'),
    browserLog: path.join(logs, 'browser.log'),
  };
}

async function verifyVsixIntegrity({ vsixPath, integrityPath, extractionRoot, signal }) {
  const integrity = JSON.parse(readFileSync(integrityPath, 'utf8'));
  assertEqual(integrity.extensionId, PROJECT_EXTENSION_ID, 'integrity extension ID');
  assertEqual(integrity.target, 'linux-x64', 'integrity target');
  assert(Array.isArray(integrity.files), 'integrity files must be an array');
  assertEqual(await sha256(vsixPath), integrity.packageSha256, 'canonical VSIX SHA-256');

  rmSync(extractionRoot, { recursive: true, force: true });
  mkdirSync(extractionRoot, { recursive: true });
  await runCommand('unzip', ['-q', vsixPath, '-d', extractionRoot], { signal });
  const expectedArchiveFiles = [
    '[Content_Types].xml',
    'extension.vsixmanifest',
    ...integrity.files.map((file) => `extension/${file.path}`),
  ].sort((left, right) => left.localeCompare(right));
  assertEqual(
    JSON.stringify(collectFiles(extractionRoot)),
    JSON.stringify(expectedArchiveFiles),
    'VSIX contents versus integrity manifest',
  );
  for (const file of integrity.files) {
    assert(typeof file.path === 'string', 'integrity file path must be a string');
    assert(Number.isSafeInteger(file.size), `integrity size is invalid for ${file.path}`);
    assert(/^[0-9a-f]{64}$/u.test(file.sha256), `integrity SHA-256 is invalid for ${file.path}`);
    const extractedPath = path.join(extractionRoot, 'extension', ...file.path.split('/'));
    assertEqual(statSync(extractedPath).size, file.size, `integrity size for ${file.path}`);
    assertEqual(await sha256(extractedPath), file.sha256, `integrity SHA-256 for ${file.path}`);
  }
  return integrity;
}

async function createDriverVsix(outputPath, signal) {
  await runCommand(
    process.execPath,
    [vsceExecutable, 'package', '--no-dependencies', '--out', outputPath],
    { cwd: driverRoot, signal },
  );
  assert(existsSync(outputPath), `installed VSIX driver was not packaged: ${outputPath}`);
}

async function verifyInstalledExtensions(serverExecutable, paths, signal) {
  const result = await runCommand(
    serverExecutable,
    [
      '--list-extensions',
      '--show-versions',
      '--extensions-dir',
      paths.extensions,
      '--server-data-dir',
      paths.serverData,
      '--accept-server-license-terms',
    ],
    { signal },
  );
  writeFileSync(
    paths.extensionListLog,
    `${result.stdout}${result.stderr ? `\n[stderr]\n${result.stderr}` : ''}`,
    'utf8',
  );
  const installedExtensions = new Set(
    result.stdout
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean),
  );
  for (const expected of [`${PROJECT_EXTENSION_ID}@1.0.0`, `${DRIVER_EXTENSION_ID}@1.0.0`]) {
    assert(
      installedExtensions.has(expected),
      `isolated extension profile is missing ${expected}:\n${result.stdout}\n${result.stderr}`,
    );
  }
}

async function downloadFile(url, destination, signal) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    throwIfAborted(signal);
    rmSync(destination, { force: true });
    try {
      const response = await fetch(url, { redirect: 'follow', signal });
      assert(response.ok, `download failed with HTTP ${response.status}: ${url}`);
      assert(response.body !== null, `download response had no body: ${url}`);
      await pipeline(Readable.fromWeb(response.body), createWriteStream(destination), { signal });
      return;
    } catch (error) {
      lastError = error;
      rmSync(destination, { force: true });
      if (signal.aborted || attempt === 3) break;
    }
  }
  throw lastError ?? new Error(`download failed: ${url}`);
}

function captureServerOutput(server, logPath) {
  writeFileSync(logPath, '', 'utf8');
  let output = '';
  const handleData = (chunk) => {
    const text = chunk.toString();
    output += text;
    appendFileSync(logPath, text, 'utf8');
  };
  server.stdout?.on('data', handleData);
  server.stderr?.on('data', handleData);
  return {
    read: () => output,
    dispose: () => {
      server.stdout?.off('data', handleData);
      server.stderr?.off('data', handleData);
    },
  };
}

async function waitForServerWebUrl(server, serverOutput, signal) {
  while (true) {
    throwIfAborted(signal);
    const match = serverOutput.read().match(/Web UI available at (https?:\/\/\S+)/u);
    if (match) return match[1];
    if (server.exitCode !== null || server.signalCode !== null) {
      throw new Error(
        `VS Code Server exited before publishing its Web UI URL: code=${server.exitCode} signal=${server.signalCode}`,
      );
    }
    await delay(50, signal);
  }
}

async function logWorkbenchResponse({ response, requestedUrl, startupUrl, logPath }) {
  let headers = {};
  let bodyPrefix = '';
  if (response) {
    try {
      headers = await response.allHeaders();
    } catch (error) {
      headers = { diagnosticError: String(error) };
    }
    try {
      bodyPrefix = (await response.text()).slice(0, 1_024);
    } catch (error) {
      bodyPrefix = `<unable to read response body: ${String(error)}>`;
    }
  }
  const diagnostic = {
    startupUrl,
    requestedUrl,
    finalUrl: response?.url() ?? null,
    status: response?.status() ?? null,
    headers,
    bodyPrefix,
  };
  const message = `[workbench-response] ${JSON.stringify(diagnostic, null, 2)}`;
  appendLog(logPath, message);
  console.log(message);
}

async function waitForResult(resultPath, signal, server) {
  while (true) {
    throwIfAborted(signal);
    if (server.exitCode !== null || server.signalCode !== null) {
      throw new Error(
        `VS Code Server exited before the driver result: code=${server.exitCode} signal=${server.signalCode}`,
      );
    }
    if (existsSync(resultPath)) return JSON.parse(readFileSync(resultPath, 'utf8'));
    await delay(250, signal);
  }
}

function validateResult(result, expected) {
  assertEqual(result.success, true, 'driver result');
  assertEqual(result.vscodeVersion, VSCODE_VERSION, 'driver VS Code version');
  assertEqual(result.platform, 'linux', 'driver platform');
  assertEqual(result.architecture, 'x64', 'driver architecture');
  assertEqual(result.modules, '137', 'driver Node ABI');
  assertEqual(result.electron, null, 'driver Electron version');
  assert(
    typeof result.remoteName === 'string' && result.remoteName.length > 0,
    'driver remoteName',
  );
  assertEqual(result.projectExtensionId, PROJECT_EXTENSION_ID, 'driver extension ID');
  assertEqual(
    JSON.stringify(result.extensionKind),
    JSON.stringify(['workspace']),
    'driver extensionKind',
  );
  assertEqual(result.projectExtensionActive, true, 'Project DNA activation');
  assertEqual(result.command, 'project-dna.analyzeRepository', 'Project DNA command');
  assertEqual(result.commandExecuted, true, 'Project DNA command execution');
  assert(Number.isSafeInteger(result.rowsBefore), 'pre-command row count must be an integer');
  assert(Number.isSafeInteger(result.rowsAfter), 'post-command row count must be an integer');
  assert(result.rowsAfter > result.rowsBefore, 'Project DNA command must persist analysis rows');
  assertEqual(result.nativeBindingSha256, expected.bindingSha256, 'driver native binding SHA-256');
  assertEqual(
    realpathSync(result.fixtureWorkspace),
    realpathSync(expected.fixtureWorkspace),
    'driver fixture',
  );
  assertPathInside(
    realpathSync(result.installedExtensionPath),
    realpathSync(expected.extensionsDirectory),
    'driver installed extension path',
  );
  assertPathOutside(
    realpathSync(result.installedExtensionPath),
    realpathSync(expected.repositoryWorkspace),
    'driver installed extension path',
  );
  assertPathInside(
    realpathSync(result.nativeBindingPath),
    realpathSync(result.installedExtensionPath),
    'driver native binding path',
  );
  assertPathInside(
    realpathSync(result.databasePath),
    realpathSync(expected.serverDataDirectory),
    'driver database path',
  );
  assertEqual(result.databaseHeaderHex, '53514c69746520666f726d6174203300', 'driver SQLite header');
}

async function runCommand(command, args, { cwd, signal }) {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    const handleAbort = () => {
      child.kill('SIGKILL');
      finish(abortError(signal));
    };
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', handleAbort);
      if (error) reject(error);
      else resolve(value);
    };
    child.once('error', (error) => finish(error));
    child.once('exit', (code, exitSignal) => {
      if (code === 0) finish(undefined, { stdout, stderr });
      else {
        finish(
          new Error(
            `${command} ${args.join(' ')} failed: code=${code} signal=${exitSignal}\n${stdout}\n${stderr}`,
          ),
        );
      }
    });
    signal.addEventListener('abort', handleAbort, { once: true });
  });
}

async function cleanup(resources) {
  const cleanupTasks = [];
  if (resources.browserContext) cleanupTasks.push(closePlaywright(resources.browserContext));
  if (resources.server) cleanupTasks.push(terminateServer(resources.server));
  const results = await Promise.allSettled(cleanupTasks);
  for (const result of results) {
    if (result.status === 'rejected') console.error('Cleanup failed', result.reason);
  }
  resources.serverOutput?.dispose();
  resources.server?.stdout?.destroy();
  resources.server?.stderr?.destroy();
}

async function closePlaywright(browserContext) {
  try {
    await withDeadline(browserContext.close(), 10_000, 'Playwright context close timed out');
  } catch (error) {
    const browser = browserContext.browser();
    if (!browser) throw error;
    await withDeadline(browser.close(), 5_000, 'Playwright browser close timed out');
  }
}

async function terminateServer(server) {
  killProcessGroup(server, 'SIGTERM');
  if (server.exitCode === null) {
    await Promise.race([onceExit(server), delayWithoutSignal(5_000)]);
  }
  if (isProcessGroupRunning(server)) {
    killProcessGroup(server, 'SIGKILL');
    if (server.exitCode === null) {
      await Promise.race([onceExit(server), delayWithoutSignal(5_000)]);
    }
  }
}

function killProcessGroup(child, signal) {
  if (typeof child.pid !== 'number') return;
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
}

function isProcessGroupRunning(child) {
  if (typeof child.pid !== 'number') return false;
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    throw error;
  }
}

function withDeadline(promise, milliseconds, message) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), milliseconds);
    timeout.unref();
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function collectFailureLogs(paths) {
  const vscodeLogs = path.join(paths.serverData, 'data', 'logs');
  if (existsSync(vscodeLogs)) {
    cpSync(vscodeLogs, path.join(paths.logs, 'vscode-server-data'), { recursive: true });
  }
  if (existsSync(paths.result)) {
    cpSync(paths.result, path.join(paths.logs, path.basename(paths.result)));
  }
  collectExtensionScanFiles(paths.extensions, paths.logs, 'extensions');
  collectExtensionScanFiles(paths.serverData, paths.logs, 'server-data');
}

function collectExtensionScanFiles(sourceRoot, logsRoot, sourceName) {
  if (!existsSync(sourceRoot)) return;
  const diagnosticNames = new Set([
    'extensions.json',
    'extensions.user.cache',
    'extensions.builtin.cache',
  ]);
  for (const relativePath of collectFiles(sourceRoot)) {
    if (!diagnosticNames.has(path.posix.basename(relativePath))) continue;
    const destination = path.join(
      logsRoot,
      'extension-scan',
      sourceName,
      ...relativePath.split('/'),
    );
    mkdirSync(path.dirname(destination), { recursive: true });
    cpSync(path.join(sourceRoot, ...relativePath.split('/')), destination);
  }
}

function createFixtureWorkspace(workspace) {
  mkdirSync(path.join(workspace, 'src'), { recursive: true });
  writeFileSync(
    path.join(workspace, 'package.json'),
    `${JSON.stringify({ name: 'project-dna-installed-fixture', version: '1.0.0', private: true }, null, 2)}\n`,
    'utf8',
  );
  writeFileSync(
    path.join(workspace, 'src', 'index.ts'),
    "export function installedVsixFixture(): string {\n  return 'project-dna';\n}\n",
    'utf8',
  );
}

function collectFiles(root, current = root) {
  const files = [];
  for (const name of readdirSync(current).sort((left, right) => left.localeCompare(right))) {
    const fullPath = path.join(current, name);
    if (statSync(fullPath).isDirectory()) files.push(...collectFiles(root, fullPath));
    else files.push(path.relative(root, fullPath).replaceAll('\\', '/'));
  }
  return files.sort((left, right) => left.localeCompare(right));
}

async function sha256(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

function appendLog(filePath, message) {
  appendFileSync(filePath, `${message}\n`, 'utf8');
}

function onceExit(child) {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => child.once('exit', resolve));
}

function delay(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(finish, milliseconds);
    const handleAbort = () => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', handleAbort);
      reject(abortError(signal));
    };
    function finish() {
      signal.removeEventListener('abort', handleAbort);
      resolve();
    }
    signal.addEventListener('abort', handleAbort, { once: true });
  });
}

function delayWithoutSignal(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function throwIfAborted(signal) {
  if (signal.aborted) throw abortError(signal);
}

function abortError(signal) {
  return signal.reason instanceof Error ? signal.reason : new Error('operation aborted');
}

function requiredEnvironment(name) {
  const value = process.env[name];
  assert(typeof value === 'string' && value.length > 0, `missing environment variable ${name}`);
  return value;
}

function assertPathInside(candidate, parent, description) {
  const relative = path.relative(parent, candidate);
  assert(
    relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative),
    `${description} must be inside ${parent}: ${candidate}`,
  );
}

function assertPathOutside(candidate, parent, description) {
  const relative = path.relative(parent, candidate);
  assert(
    relative.startsWith('..') || path.isAbsolute(relative),
    `${description} must be outside ${parent}: ${candidate}`,
  );
}

function assertEqual(actual, expected, description) {
  assert(actual === expected, `${description}: expected ${expected}, received ${actual}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
