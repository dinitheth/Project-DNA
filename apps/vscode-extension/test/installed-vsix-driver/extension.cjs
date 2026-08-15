const { createHash } = require('node:crypto');
const {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');
const vscode = require('vscode');
const { sameFilesystemPath } = require('./path-utils.cjs');

const PROJECT_EXTENSION_ID = 'project-dna.vscode-extension';
const NATIVE_BINDING =
  process.env.PROJECT_DNA_EXPECTED_NATIVE_BINDING ??
  'native/linux-x64/node-abi137/better_sqlite3.node';
const SQLITE_HEADER_HEX = '53514c69746520666f726d6174203300';
const COMMAND_TIMEOUT_MS = 30_000;
const EXPECTED_VSCODE_VERSION = process.env.PROJECT_DNA_EXPECTED_VSCODE_VERSION ?? '1.132.0';
const EXPECTED_PLATFORM = process.env.PROJECT_DNA_EXPECTED_PLATFORM ?? 'linux';
const EXPECTED_ARCHITECTURE = process.env.PROJECT_DNA_EXPECTED_ARCHITECTURE ?? 'x64';
const EXPECTED_MODULES = process.env.PROJECT_DNA_EXPECTED_MODULES ?? '137';
const EXPECTED_ELECTRON = process.env.PROJECT_DNA_EXPECTED_ELECTRON_VERSION;
const EXPECTED_REMOTE = process.env.PROJECT_DNA_EXPECTED_REMOTE !== 'false';

async function activate(context) {
  const resultPath = path.join(context.globalStorageUri.fsPath, 'installed-extension-host.json');
  try {
    const result = await validateInstalledExtension(context);
    writeResult(resultPath, { success: true, ...result });
  } catch (error) {
    writeResult(resultPath, {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
}

async function validateInstalledExtension(context) {
  assertEqual(vscode.version, EXPECTED_VSCODE_VERSION, 'VS Code version');
  assertEqual(process.platform, EXPECTED_PLATFORM, 'Extension Host platform');
  assertEqual(process.arch, EXPECTED_ARCHITECTURE, 'Extension Host architecture');
  assertEqual(process.versions.modules, EXPECTED_MODULES, 'Extension Host Node ABI');
  if (EXPECTED_ELECTRON === undefined) {
    assert(
      process.versions.electron === undefined,
      'remote Extension Host must not expose Electron',
    );
  } else {
    assertEqual(process.versions.electron, EXPECTED_ELECTRON, 'Electron version');
  }
  if (EXPECTED_REMOTE) {
    assert(
      typeof vscode.env.remoteName === 'string' && vscode.env.remoteName.length > 0,
      'vscode.env.remoteName must identify a remote Extension Host',
    );
  } else {
    assert(
      vscode.env.remoteName === undefined || vscode.env.remoteName.length === 0,
      'desktop Extension Host must not identify a remote host',
    );
  }

  const expectedExtensionsDirectory = realpathSync(
    requiredEnvironment('PROJECT_DNA_EXPECTED_EXTENSIONS_DIR'),
  );
  const repositoryWorkspace = realpathSync(requiredEnvironment('PROJECT_DNA_GITHUB_WORKSPACE'));
  const fixtureWorkspace = realpathSync(requiredEnvironment('PROJECT_DNA_FIXTURE_WORKSPACE'));
  const expectedBindingSha256 = requiredEnvironment('PROJECT_DNA_BINDING_SHA256');
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  assert(workspaceFolder !== undefined, 'fixture workspace was not opened');
  const actualWorkspace = realpathSync(workspaceFolder);
  assert(
    sameFilesystemPath(actualWorkspace, fixtureWorkspace),
    `fixture workspace path: expected ${fixtureWorkspace}, received ${actualWorkspace}`,
  );

  const projectExtension = vscode.extensions.getExtension(PROJECT_EXTENSION_ID);
  assert(
    projectExtension !== undefined,
    `installed extension ${PROJECT_EXTENSION_ID} was not found`,
  );
  const installedExtensionPath = realpathSync(projectExtension.extensionPath);
  assertPathInside(installedExtensionPath, expectedExtensionsDirectory, 'installed extension path');
  assertPathOutside(installedExtensionPath, repositoryWorkspace, 'installed extension path');
  assertEqual(
    JSON.stringify(projectExtension.packageJSON.extensionKind),
    JSON.stringify(['workspace']),
    'Project DNA extensionKind',
  );

  const bindingPath = path.join(installedExtensionPath, ...NATIVE_BINDING.split('/'));
  assert(existsSync(bindingPath), `packaged native binding is missing: ${bindingPath}`);
  assertEqual(sha256(bindingPath), expectedBindingSha256, 'packaged native binding SHA-256');

  await projectExtension.activate();
  assert(projectExtension.isActive, 'Project DNA did not activate');

  const databasePath = path.join(
    path.dirname(context.globalStorageUri.fsPath),
    PROJECT_EXTENSION_ID,
    'project-dna.sqlite',
  );
  assert(existsSync(databasePath), `Project DNA SQLite database was not created: ${databasePath}`);
  assertEqual(
    readFileSync(databasePath).subarray(0, 16).toString('hex'),
    SQLITE_HEADER_HEX,
    'SQLite database header',
  );

  const requireFromProject = createRequire(path.join(installedExtensionPath, 'package.json'));
  const Database = requireFromProject('./node_modules/better-sqlite3');
  const rowsBefore = countStoredRows(Database, databasePath, bindingPath);
  await withDeadline(
    vscode.commands.executeCommand('project-dna.analyzeRepository'),
    COMMAND_TIMEOUT_MS,
    'project-dna.analyzeRepository failed to resolve within 30 seconds',
  );
  const rowsAfter = countStoredRows(Database, databasePath, bindingPath);
  assert(rowsAfter > rowsBefore, 'Project DNA command did not persist analysis results');

  return {
    vscodeVersion: vscode.version,
    platform: process.platform,
    architecture: process.arch,
    modules: process.versions.modules,
    electron: process.versions.electron ?? null,
    remoteName: vscode.env.remoteName ?? null,
    projectExtensionId: projectExtension.id,
    installedExtensionPath,
    expectedExtensionsDirectory,
    fixtureWorkspace,
    extensionKind: projectExtension.packageJSON.extensionKind,
    nativeBindingPath: bindingPath,
    nativeBindingSha256: expectedBindingSha256,
    projectExtensionActive: projectExtension.isActive,
    command: 'project-dna.analyzeRepository',
    commandExecuted: true,
    databasePath,
    databaseHeaderHex: SQLITE_HEADER_HEX,
    rowsBefore,
    rowsAfter,
  };
}

function countStoredRows(Database, databasePath, bindingPath) {
  const database = new Database(databasePath, {
    readonly: true,
    fileMustExist: true,
    nativeBinding: bindingPath,
  });
  try {
    const row = database.prepare('SELECT COUNT(*) AS count FROM dna_store').get();
    assert(Number.isSafeInteger(row?.count), 'Project DNA database row count is invalid');
    return row.count;
  } finally {
    database.close();
  }
}

function withDeadline(promise, timeoutMs, message) {
  let timeout;
  const deadline = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timeout));
}

function writeResult(resultPath, result) {
  mkdirSync(path.dirname(resultPath), { recursive: true });
  const temporaryPath = `${resultPath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  renameSync(temporaryPath, resultPath);
}

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
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

function requiredEnvironment(name) {
  const value = process.env[name];
  assert(typeof value === 'string' && value.length > 0, `missing environment variable ${name}`);
  return value;
}

function assertEqual(actual, expected, description) {
  assert(actual === expected, `${description}: expected ${expected}, received ${actual}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

exports.activate = activate;
