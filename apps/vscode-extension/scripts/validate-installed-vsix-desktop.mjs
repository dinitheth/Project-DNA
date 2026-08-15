import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  captureDriverResult,
  createClientCommand,
  downloadFile,
  formatDriverFailure,
  findClientExecutables,
  runCommand,
  runStage,
  runWithCleanup,
} from './installed-desktop-validation-helpers.mjs';

const HARD_TIMEOUT_MS = 12 * 60 * 1000;
const STAGE_TIMEOUT_MS = {
  integrity: 2 * 60 * 1000,
  download: 8 * 60 * 1000,
  checksum: 2 * 60 * 1000,
  extraction: 2 * 60 * 1000,
  discovery: 15 * 1000,
  version: 30 * 1000,
  driverPackage: 60 * 1000,
  extensionInstall: 90 * 1000,
  extensionList: 60 * 1000,
  clientLaunch: 15 * 1000,
  runtimeValidation: HARD_TIMEOUT_MS,
};
const PROJECT_EXTENSION_ID = 'project-dna.vscode-extension';
const DRIVER_EXTENSION_ID = 'project-dna-tests.project-dna-installed-vsix-driver';
const SQLITE_HEADER_HEX = '53514c69746520666f726d6174203300';
const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(scriptRoot, '..');
const driverRoot = path.join(extensionRoot, 'test', 'installed-vsix-driver');
const require = createRequire(import.meta.url);
const vsceExecutable = require.resolve('@vscode/vsce/vsce');

const version = requiredEnvironment('PROJECT_DNA_EXPECTED_VSCODE_VERSION');
const target = requiredEnvironment('PROJECT_DNA_EXPECTED_TARGET');
const archiveChannel = requiredEnvironment('PROJECT_DNA_VSCODE_ARCHIVE_CHANNEL');
const archiveSha256 = requiredEnvironment('PROJECT_DNA_VSCODE_ARCHIVE_SHA256');
const electronVersion = requiredEnvironment('PROJECT_DNA_EXPECTED_ELECTRON_VERSION');
const expectedPlatform = target.split('-')[0];
const expectedArchitecture = target.split('-')[1];
const nativeBinding = `native/${target}/electron-abi146/better_sqlite3.node`;
const archiveUrl = `https://update.code.visualstudio.com/${version}/${archiveChannel}/stable`;

await main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  assert(process.platform === expectedPlatform, `desktop runner must be ${expectedPlatform}`);
  assert(process.arch === expectedArchitecture, `desktop runner must be ${expectedArchitecture}`);
  assert(/^[0-9a-f]{64}$/u.test(archiveSha256), 'VS Code archive SHA-256 is invalid');

  const runnerTemp = realpathSync(requiredEnvironment('RUNNER_TEMP'));
  const repositoryWorkspace = realpathSync(requiredEnvironment('GITHUB_WORKSPACE'));
  const validationRoot = path.join(runnerTemp, `project-dna-compat-desktop-${version}-${target}`);
  assertPathInside(validationRoot, runnerTemp, 'validation root');
  assertPathOutside(validationRoot, repositoryWorkspace, 'validation root');
  rmSync(validationRoot, { recursive: true, force: true });

  const paths = createPaths(validationRoot);
  for (const directory of Object.values(paths.directories)) {
    mkdirSync(directory, { recursive: true });
  }
  createFixtureWorkspace(paths.workspace);
  const logger = createStageLogger(paths.stageLog);

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error(`desktop VSIX validation exceeded ${HARD_TIMEOUT_MS} ms`));
  }, HARD_TIMEOUT_MS);
  timeout.unref();
  const resources = { client: undefined, clientOutput: undefined };
  let failure;
  try {
    await runWithCleanup(
      () =>
        runValidation({
          paths,
          resources,
          repositoryWorkspace,
          signal: controller.signal,
          logger,
        }),
      async () => {
        controller.abort(new Error('desktop VSIX validation cleanup'));
        await cleanup(resources);
      },
    );
  } catch (error) {
    failure = error;
    if (resources.clientOutput) {
      console.error(`VS Code desktop output before failure:\n${resources.clientOutput.read()}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    if (failure) collectFailureLogs(paths);
  }
}

async function runValidation({ paths, resources, repositoryWorkspace, signal, logger }) {
  const stage = (name, timeoutMs, operation) =>
    runStage(name, { signal, timeoutMs, logger }, operation);
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
  const integrity = await stage(
    'VSIX integrity validation',
    STAGE_TIMEOUT_MS.integrity,
    (stageSignal) =>
      verifyVsixIntegrity({
        vsixPath,
        integrityPath,
        extractionRoot: paths.integrityExtraction,
        signal: stageSignal,
      }),
  );
  const binding = integrity.files.find((file) => file.path === nativeBinding);
  assert(binding !== undefined, `integrity manifest is missing ${nativeBinding}`);

  await stage('official archive download', STAGE_TIMEOUT_MS.download, (stageSignal) =>
    downloadFile(archiveUrl, paths.clientArchive, { signal: stageSignal, logger }),
  );
  await stage('official archive checksum', STAGE_TIMEOUT_MS.checksum, async () =>
    assertEqual(
      await sha256(paths.clientArchive),
      archiveSha256,
      'official VS Code archive SHA-256',
    ),
  );
  await stage('official archive extraction', STAGE_TIMEOUT_MS.extraction, (stageSignal) =>
    extractArchive(paths.clientArchive, paths.clientRoot, stageSignal),
  );
  const executables = await stage(
    'official executable discovery',
    STAGE_TIMEOUT_MS.discovery,
    async () => findClientExecutables({ clientRoot: paths.clientRoot, expectedPlatform }),
  );
  logger(
    `client discovery platform=${expectedPlatform} runtime=${JSON.stringify(executables.runtime)} cliSource=${JSON.stringify(executables.cli.source)} cliExecutable=${JSON.stringify(executables.cli.executable)} cliPrefixArguments=${JSON.stringify(executables.cli.prefixArguments)} cliWorkingDirectory=${JSON.stringify(executables.cli.workingDirectory ?? process.cwd())} cliEnvironment=${JSON.stringify(executables.cli.environment)}`,
  );
  await stage('official version verification', STAGE_TIMEOUT_MS.version, async (stageSignal) => {
    const clientVersion = await runClientCommand(executables, ['--version'], {
      signal: stageSignal,
      logger,
      label: 'official-version',
    });
    assertEqual(
      clientVersion.stdout.split(/\r?\n/u).filter(Boolean)[0],
      version,
      'official VS Code version',
    );
  });

  await stage('test driver packaging', STAGE_TIMEOUT_MS.driverPackage, (stageSignal) =>
    createDriverVsix(paths.driverVsix, stageSignal),
  );
  for (const extension of [vsixPath, paths.driverVsix]) {
    await stage(
      `extension installation (${path.basename(extension)})`,
      STAGE_TIMEOUT_MS.extensionInstall,
      (stageSignal) =>
        runClientCommand(
          executables,
          [...clientArguments(paths), '--install-extension', extension, '--force'],
          {
            signal: stageSignal,
            logger,
            label: `extension-install-${path.basename(extension)}`,
          },
        ),
    );
  }
  await stage('extension listing', STAGE_TIMEOUT_MS.extensionList, (stageSignal) =>
    verifyInstalledExtensions(executables, paths, stageSignal, logger),
  );

  const client = await stage(
    'client launch',
    STAGE_TIMEOUT_MS.clientLaunch,
    async (stageSignal) => {
      const launchedClient = startClient(
        executables.runtime,
        paths,
        {
          PROJECT_DNA_EXPECTED_VSCODE_VERSION: version,
          PROJECT_DNA_EXPECTED_PLATFORM: expectedPlatform,
          PROJECT_DNA_EXPECTED_ARCHITECTURE: expectedArchitecture,
          PROJECT_DNA_EXPECTED_MODULES: '146',
          PROJECT_DNA_EXPECTED_ELECTRON_VERSION: electronVersion,
          PROJECT_DNA_EXPECTED_REMOTE: 'false',
          PROJECT_DNA_EXPECTED_NATIVE_BINDING: nativeBinding,
          PROJECT_DNA_EXPECTED_EXTENSIONS_DIR: paths.extensions,
          PROJECT_DNA_GITHUB_WORKSPACE: repositoryWorkspace,
          PROJECT_DNA_FIXTURE_WORKSPACE: paths.workspace,
          PROJECT_DNA_BINDING_SHA256: binding.sha256,
        },
        logger,
      );
      resources.client = launchedClient;
      resources.clientOutput = captureOutput(launchedClient, paths.clientLog);
      await waitForSpawn(launchedClient, stageSignal);
      return launchedClient;
    },
  );

  const result = await stage(
    'installed Extension Host runtime validation',
    STAGE_TIMEOUT_MS.runtimeValidation,
    (stageSignal) => waitForResult(paths.result, stageSignal, client),
  );
  try {
    validateResult(result, {
      bindingSha256: binding.sha256,
      extensionsDirectory: paths.extensions,
      fixtureWorkspace: paths.workspace,
      repositoryWorkspace,
      userDataDirectory: paths.userData,
    });
  } catch (error) {
    const captured = captureDriverResult({
      resultPath: paths.result,
      failureLogDirectory: paths.logs,
      result,
    });
    const diagnostic = formatDriverFailure(captured?.result);
    if (diagnostic !== undefined) throw new Error(diagnostic, { cause: error });
    throw error;
  }
  console.log(JSON.stringify(result, null, 2));
}

function createPaths(validationRoot) {
  const downloads = path.join(validationRoot, 'downloads');
  const logs = path.join(validationRoot, 'logs');
  const userData = path.join(validationRoot, 'user-data');
  return {
    downloads,
    extensions: path.join(validationRoot, 'extensions'),
    integrityExtraction: path.join(validationRoot, 'integrity-extracted'),
    workspace: path.join(validationRoot, 'workspace'),
    userData,
    clientRoot: path.join(downloads, 'vscode'),
    clientArchive: path.join(downloads, `vscode-${version}-${target}.${archiveExtension()}`),
    driverVsix: path.join(downloads, 'project-dna-installed-vsix-driver.vsix'),
    result: path.join(
      userData,
      'User',
      'globalStorage',
      DRIVER_EXTENSION_ID,
      'installed-extension-host.json',
    ),
    extensionListLog: path.join(logs, 'installed-extensions.txt'),
    driverResultLog: path.join(logs, 'installed-extension-host.json'),
    clientLog: path.join(logs, 'client.log'),
    stageLog: path.join(logs, 'stages.log'),
    logs,
    directories: {
      downloads,
      extensions: path.join(validationRoot, 'extensions'),
      workspace: path.join(validationRoot, 'workspace'),
      userData,
      logs,
    },
  };
}

function archiveExtension() {
  return expectedPlatform === 'linux' ? 'tar.gz' : 'zip';
}

function clientArguments(paths) {
  return [
    '--user-data-dir',
    paths.userData,
    '--extensions-dir',
    paths.extensions,
    '--disable-updates',
  ];
}

function startClient(executable, paths, environment, logger) {
  const args = [
    ...clientArguments(paths),
    '--disable-gpu',
    '--skip-welcome',
    '--new-window',
    paths.workspace,
  ];
  const command = process.platform === 'linux' ? 'xvfb-run' : executable;
  const commandArgs =
    process.platform === 'linux' ? ['--auto-servernum', executable, ...args] : args;
  logger(
    `client launch status=creating executable=${JSON.stringify(command)} runtime=${JSON.stringify(executable)} cwd=${JSON.stringify(paths.downloads)} arguments=${JSON.stringify(commandArgs)} environment=${JSON.stringify(environment)}`,
  );
  const child = spawn(command, commandArgs, {
    cwd: paths.downloads,
    detached: process.platform !== 'win32',
    env: { ...process.env, ...environment },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  logger(`client launch status=created pid=${child.pid ?? 'unavailable'}`);
  return child;
}

async function waitForSpawn(child, signal) {
  throwIfAborted(signal);
  if (child.pid !== undefined) return;
  await new Promise((resolve, reject) => {
    const finish = (error) => {
      signal.removeEventListener('abort', onAbort);
      child.off('spawn', onSpawn);
      child.off('error', onError);
      if (error) reject(error);
      else resolve();
    };
    const onAbort = () => finish(abortError(signal));
    const onSpawn = () => finish();
    const onError = (error) => finish(error);
    signal.addEventListener('abort', onAbort, { once: true });
    child.once('spawn', onSpawn);
    child.once('error', onError);
  });
}

async function verifyVsixIntegrity({ vsixPath, integrityPath, extractionRoot, signal }) {
  const integrity = JSON.parse(readFileSync(integrityPath, 'utf8'));
  assertEqual(integrity.extensionId, PROJECT_EXTENSION_ID, 'integrity extension ID');
  assertEqual(integrity.target, target, 'integrity target');
  assert(Array.isArray(integrity.files), 'integrity files must be an array');
  assertEqual(await sha256(vsixPath), integrity.packageSha256, 'canonical VSIX SHA-256');

  rmSync(extractionRoot, { recursive: true, force: true });
  mkdirSync(extractionRoot, { recursive: true });
  await extractZip(vsixPath, extractionRoot, signal);
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
    {
      cwd: driverRoot,
      signal,
    },
  );
  assert(existsSync(outputPath), `compatibility driver VSIX is missing: ${outputPath}`);
}

async function verifyInstalledExtensions(executables, paths, signal, logger) {
  const result = await runClientCommand(
    executables,
    [...clientArguments(paths), '--list-extensions', '--show-versions'],
    {
      signal,
      logger,
      label: 'extension-list',
    },
  );
  writeFileSync(
    paths.extensionListLog,
    `${result.stdout}${result.stderr ? `\n[stderr]\n${result.stderr}` : ''}`,
    'utf8',
  );
  const installed = new Set(
    result.stdout
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean),
  );
  for (const extension of [`${PROJECT_EXTENSION_ID}@1.0.0`, `${DRIVER_EXTENSION_ID}@1.0.0`]) {
    assert(installed.has(extension), `isolated extension profile is missing ${extension}`);
  }
}

async function extractArchive(archive, destination, signal) {
  mkdirSync(destination, { recursive: true });
  if (expectedPlatform === 'linux') {
    await runCommand('tar', ['-xzf', archive, '-C', destination], { signal });
    return;
  }
  await extractZip(archive, destination, signal);
}

async function extractZip(archive, destination, signal) {
  if (process.platform === 'win32') {
    try {
      await runCommand('7z', ['x', '-y', `-o${destination}`, archive], { signal });
    } catch {
      await runCommand('tar', ['-xf', archive, '-C', destination], { signal });
    }
    return;
  }
  await runCommand('unzip', ['-q', archive, '-d', destination], { signal });
}

function captureOutput(child, logPath) {
  writeFileSync(logPath, '', 'utf8');
  let output = '';
  const append = (chunk) => {
    const text = chunk.toString();
    output += text;
    appendFileSync(logPath, text, 'utf8');
  };
  child.stdout?.on('data', append);
  child.stderr?.on('data', append);
  return {
    read: () => output,
    dispose: () => {
      child.stdout?.off('data', append);
      child.stderr?.off('data', append);
    },
  };
}

async function waitForResult(resultPath, signal, client) {
  while (true) {
    throwIfAborted(signal);
    if (client.exitCode !== null || client.signalCode !== null) {
      throw new Error(
        `VS Code exited before the driver result: code=${client.exitCode} signal=${client.signalCode}`,
      );
    }
    if (existsSync(resultPath)) return JSON.parse(readFileSync(resultPath, 'utf8'));
    await delay(250, signal);
  }
}

function validateResult(result, expected) {
  assertEqual(result.success, true, 'driver result');
  assertEqual(result.vscodeVersion, version, 'driver VS Code version');
  assertEqual(result.platform, expectedPlatform, 'driver platform');
  assertEqual(result.architecture, expectedArchitecture, 'driver architecture');
  assertEqual(result.modules, '146', 'driver Node ABI');
  assertEqual(result.electron, electronVersion, 'driver Electron version');
  assert(result.remoteName === null, 'desktop Extension Host must not report a remote name');
  assertEqual(result.projectExtensionId, PROJECT_EXTENSION_ID, 'driver extension ID');
  assertEqual(JSON.stringify(result.extensionKind), JSON.stringify(['workspace']), 'extensionKind');
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
    'fixture path',
  );
  assertPathInside(
    realpathSync(result.installedExtensionPath),
    realpathSync(expected.extensionsDirectory),
    'installed extension path',
  );
  assertPathOutside(
    realpathSync(result.installedExtensionPath),
    realpathSync(expected.repositoryWorkspace),
    'installed extension path',
  );
  assertPathInside(
    realpathSync(result.nativeBindingPath),
    realpathSync(result.installedExtensionPath),
    'native binding path',
  );
  assertPathInside(
    realpathSync(result.databasePath),
    realpathSync(expected.userDataDirectory),
    'database path',
  );
  assertEqual(result.databaseHeaderHex, SQLITE_HEADER_HEX, 'SQLite database header');
}

function createFixtureWorkspace(workspace) {
  writeFileSync(
    path.join(workspace, 'package.json'),
    `${JSON.stringify({ name: 'project-dna-installed-fixture', version: '1.0.0', private: true }, null, 2)}\n`,
    'utf8',
  );
  writeFileSync(path.join(workspace, 'index.ts'), 'export const answer = 42;\n', 'utf8');
}

function collectFiles(root, prefix = '') {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...collectFiles(path.join(root, entry.name), relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function runClientCommand(executables, args, options) {
  const invocation = createClientCommand(executables.cli, args);
  return runCommand(invocation.command, invocation.args, {
    ...options,
    cwd: invocation.cwd,
    environment: invocation.environment,
  });
}

async function cleanup(resources) {
  const cleanupTasks = resources.client ? [terminateClient(resources.client)] : [];
  const results = await Promise.allSettled(cleanupTasks);
  for (const result of results) {
    if (result.status === 'rejected') console.error('Cleanup failed', result.reason);
  }
  resources.clientOutput?.dispose();
  resources.client?.stdout?.destroy();
  resources.client?.stderr?.destroy();
}

async function terminateClient(client) {
  if (client.exitCode !== null || client.signalCode !== null || client.pid === undefined) return;
  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      const taskkill = spawn('taskkill', ['/pid', String(client.pid), '/t', '/f'], {
        stdio: 'ignore',
      });
      taskkill.once('exit', resolve);
      taskkill.once('error', resolve);
    });
    return;
  }
  try {
    process.kill(-client.pid, 'SIGTERM');
  } catch {
    return;
  }
  await delay(1_000);
  if (client.exitCode === null && client.signalCode === null) {
    try {
      process.kill(-client.pid, 'SIGKILL');
    } catch {
      // The process exited while cleanup was waiting.
    }
  }
}

function collectFailureLogs(paths) {
  const files = [
    paths.stageLog,
    paths.clientLog,
    paths.extensionListLog,
    paths.driverResultLog,
  ].filter(existsSync);
  for (const file of files) {
    console.error(`Compatibility diagnostic ${file}:\n${readFileSync(file, 'utf8')}`);
  }
}

function createStageLogger(logPath) {
  writeFileSync(logPath, '', 'utf8');
  return (message) => {
    const line = `${new Date().toISOString()} ${message}`;
    appendFileSync(logPath, `${line}\n`, 'utf8');
    console.error(line);
  };
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

async function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function assertEqual(actual, expected, description) {
  assert(actual === expected, `${description}: expected ${expected}, received ${actual}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function throwIfAborted(signal) {
  if (signal.aborted) throw abortError(signal);
}

function abortError(signal) {
  return signal.reason instanceof Error ? signal.reason : new Error('validation aborted');
}

function delay(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError(signal));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
