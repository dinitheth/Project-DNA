import { execFile as execFileCallback } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

const EXPECTED_PACKAGE_MANAGER = 'pnpm@9.15.4';
const EXPECTED_NODE_ENGINE = '>=20';
const TEST_FILE_PATTERN = /\.(?:test|spec)\.[cm]?[jt]sx?$/u;

/**
 * Discover workspace metadata using PNPM and repository configuration files.
 * Validation is intentionally kept out of this function so the rules remain pure and testable.
 *
 * @param {string} rootPath absolute or relative repository root
 * @param {{ runPnpmList?: (rootPath: string) => Promise<string> }} adapters discovery adapters
 * @returns {Promise<WorkspaceSnapshot>}
 */
export async function discoverWorkspace(rootPath, adapters = {}) {
  const resolvedRoot = path.resolve(rootPath);
  const runPnpmList = adapters.runPnpmList ?? executePnpmList;
  const workspaceRecords = parsePnpmWorkspaceList(await runPnpmList(resolvedRoot));
  const rootRecord = workspaceRecords.find(
    (record) => normalizedAbsolutePath(record.path) === normalizedAbsolutePath(resolvedRoot),
  );

  if (!rootRecord) {
    throw new Error(`PNPM did not report the workspace root at ${resolvedRoot}`);
  }

  const [rootPackageJson, rootTsConfig, vitestWorkspaceSource] = await Promise.all([
    readJsonFile(path.join(resolvedRoot, 'package.json')),
    readJsonFile(path.join(resolvedRoot, 'tsconfig.json')),
    readFile(path.join(resolvedRoot, 'vitest.workspace.ts'), 'utf8'),
  ]);

  const packages = await Promise.all(
    workspaceRecords
      .filter((record) => record !== rootRecord)
      .map(async (record) => {
        const relativePath = normalizeRelativePath(path.relative(resolvedRoot, record.path));
        const packageJson = await readJsonFile(path.join(record.path, 'package.json'));
        return {
          name: record.name,
          path: relativePath,
          packageJson,
          hasTsConfig: (await readOptionalFile(path.join(record.path, 'tsconfig.json'))) !== null,
          hasTests: await containsTestFiles(path.join(record.path, 'src', '__tests__')),
        };
      }),
  );

  return {
    rootPath: resolvedRoot,
    rootPackageJson,
    packages,
    tsconfigReferences: parseTypeScriptReferences(rootTsConfig),
    vitestProjects: parseVitestWorkspaceProjects(vitestWorkspaceSource),
  };
}

/**
 * Parse and validate the JSON emitted by `pnpm list --recursive --depth -1 --json`.
 *
 * @param {string} source PNPM JSON output
 * @returns {PnpmWorkspaceRecord[]}
 */
export function parsePnpmWorkspaceList(source) {
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error(`PNPM workspace output is not valid JSON: ${errorMessage(error)}`, {
      cause: error,
    });
  }

  if (!Array.isArray(parsed)) {
    throw new Error('PNPM workspace output must be a JSON array');
  }

  return parsed.map((record, index) => {
    if (!isRecord(record) || typeof record.name !== 'string' || typeof record.path !== 'string') {
      throw new Error(`PNPM workspace record at index ${index} must contain string name and path`);
    }
    return { name: record.name, path: path.resolve(record.path) };
  });
}

/**
 * Extract normalized TypeScript project-reference paths from a parsed root tsconfig.
 *
 * @param {unknown} tsconfig parsed tsconfig.json value
 * @returns {string[]}
 */
export function parseTypeScriptReferences(tsconfig) {
  if (!isRecord(tsconfig) || !Array.isArray(tsconfig.references)) return [];

  return sortedUnique(
    tsconfig.references.flatMap((reference) => {
      if (!isRecord(reference) || typeof reference.path !== 'string') return [];
      return [normalizeWorkspacePath(reference.path)];
    }),
  );
}

/**
 * Extract explicit package/app paths from the Vitest workspace configuration.
 * The repository uses a static `defineWorkspace([...])` list, so only quoted workspace paths are
 * accepted; dynamic expressions are deliberately not interpreted by this validation tool.
 *
 * @param {string} source vitest.workspace.ts source
 * @returns {string[]}
 */
export function parseVitestWorkspaceProjects(source) {
  const projects = [];
  const quotedPathPattern = /['"]((?:packages|apps)[\\/][^'"]+)['"]/gu;
  for (const match of source.matchAll(quotedPathPattern)) {
    const projectPath = match[1];
    if (projectPath) projects.push(normalizeWorkspacePath(projectPath));
  }
  return sortedUnique(projects);
}

/**
 * Validate a previously discovered workspace snapshot without performing I/O.
 *
 * @param {WorkspaceSnapshot} snapshot workspace metadata
 * @returns {ValidationIssue[]}
 */
export function validateWorkspace(snapshot) {
  const issues = [];
  const rootPackage = isRecord(snapshot.rootPackageJson) ? snapshot.rootPackageJson : {};

  if (!isRecord(snapshot.rootPackageJson)) {
    issues.push(
      issue('INVALID_PACKAGE_JSON_SHAPE', 'package.json', 'root package.json must be an object'),
    );
  }

  if (rootPackage.packageManager !== EXPECTED_PACKAGE_MANAGER) {
    issues.push(
      issue(
        'PACKAGE_MANAGER_MISMATCH',
        'package.json',
        `packageManager must be ${EXPECTED_PACKAGE_MANAGER}`,
      ),
    );
  }

  const nodeEngine = isRecord(rootPackage.engines) ? rootPackage.engines.node : undefined;
  if (nodeEngine !== EXPECTED_NODE_ENGINE) {
    issues.push(
      issue('NODE_ENGINE_MISMATCH', 'package.json', `engines.node must be ${EXPECTED_NODE_ENGINE}`),
    );
  }

  const rootScripts = isRecord(rootPackage.scripts) ? rootPackage.scripts : {};
  for (const scriptName of [
    'build',
    'check:workspace',
    'format:check',
    'lint',
    'test',
    'typecheck',
    'verify',
  ]) {
    validateRequiredScript(rootScripts, scriptName, 'package.json', issues);
  }

  validateDuplicateValues(
    snapshot.packages,
    (workspacePackage) => workspacePackage.name,
    'DUPLICATE_PACKAGE_NAME',
    'Workspace package name',
    issues,
  );
  validateDuplicateValues(
    snapshot.packages,
    (workspacePackage) => normalizeWorkspacePath(workspacePackage.path),
    'DUPLICATE_PACKAGE_PATH',
    'Workspace package path',
    issues,
  );

  const tsconfigReferences = new Set(snapshot.tsconfigReferences.map(normalizeWorkspacePath));
  const vitestProjects = new Set(snapshot.vitestProjects.map(normalizeWorkspacePath));

  for (const workspacePackage of snapshot.packages) {
    const packagePath = normalizeWorkspacePath(workspacePackage.path);
    const packageJsonPath = `${packagePath}/package.json`;
    const packageJson = isRecord(workspacePackage.packageJson) ? workspacePackage.packageJson : {};
    const scripts = isRecord(packageJson.scripts) ? packageJson.scripts : {};

    if (!isRecord(workspacePackage.packageJson)) {
      issues.push(
        issue(
          'INVALID_PACKAGE_JSON_SHAPE',
          packageJsonPath,
          'workspace package.json must be an object',
        ),
      );
    }

    if (
      path.posix.isAbsolute(packagePath) ||
      packagePath === '..' ||
      packagePath.startsWith('../')
    ) {
      issues.push(
        issue(
          'PACKAGE_OUTSIDE_WORKSPACE',
          packageJsonPath,
          'workspace package path must remain inside the repository root',
        ),
      );
    }

    if (packageJson.name !== workspacePackage.name) {
      issues.push(
        issue(
          'PACKAGE_NAME_MISMATCH',
          packageJsonPath,
          `package name must match PNPM workspace name ${workspacePackage.name}`,
        ),
      );
    }

    validateRequiredScript(scripts, 'lint', packageJsonPath, issues);
    validateRequiredScript(scripts, 'clean', packageJsonPath, issues);

    if (workspacePackage.hasTsConfig) {
      validateRequiredScript(scripts, 'typecheck', packageJsonPath, issues);
      if (!tsconfigReferences.has(packagePath)) {
        issues.push(
          issue(
            'MISSING_TYPESCRIPT_REFERENCE',
            'tsconfig.json',
            `missing project reference for ${packagePath}`,
          ),
        );
      }
    }

    const lintScript = stringProperty(scripts, 'lint');
    if (lintScript && !lintScript.includes('--max-warnings=0')) {
      issues.push(
        issue(
          'LINT_WARNINGS_ALLOWED',
          packageJsonPath,
          'lint script must include --max-warnings=0',
        ),
      );
    }

    const cleanScript = stringProperty(scripts, 'clean');
    if (cleanScript) {
      if (/(?:^|\s)rm\s+-rf(?:\s|$)/u.test(cleanScript)) {
        issues.push(
          issue(
            'NON_PORTABLE_CLEAN_SCRIPT',
            packageJsonPath,
            'clean script must use rimraf instead of rm -rf',
          ),
        );
      } else if (!/(?:^|\s)rimraf(?:\s|$)/u.test(cleanScript)) {
        issues.push(
          issue(
            'CLEAN_SCRIPT_MUST_USE_RIMRAF',
            packageJsonPath,
            'clean script must use rimraf for cross-platform deletion',
          ),
        );
      }
    }

    if (workspacePackage.hasTests) {
      validateRequiredScript(scripts, 'test', packageJsonPath, issues);
      validateRequiredScript(scripts, 'test:watch', packageJsonPath, issues);

      const testScript = stringProperty(scripts, 'test');
      if (testScript?.includes('--passWithNoTests')) {
        issues.push(
          issue(
            'PASS_WITH_NO_TESTS_FOR_TESTED_PACKAGE',
            packageJsonPath,
            'test script must not use --passWithNoTests when test files exist',
          ),
        );
      }

      const watchScript = stringProperty(scripts, 'test:watch');
      if (watchScript && watchScript !== 'vitest') {
        issues.push(
          issue(
            'NON_STANDARD_TEST_WATCH_SCRIPT',
            packageJsonPath,
            'test:watch script must be exactly vitest',
          ),
        );
      }

      if (!vitestProjects.has(packagePath)) {
        issues.push(
          issue(
            'MISSING_VITEST_PROJECT',
            'vitest.workspace.ts',
            `missing test project for ${packagePath}`,
          ),
        );
      }
    }
  }

  return issues.sort(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      left.code.localeCompare(right.code) ||
      left.message.localeCompare(right.message),
  );
}

/**
 * Format validation issues for deterministic CLI output.
 *
 * @param {ValidationIssue[]} issues validation issues
 * @returns {string}
 */
export function formatValidationIssues(issues) {
  if (issues.length === 0) return 'Workspace validation passed.';

  const noun = issues.length === 1 ? 'issue' : 'issues';
  return [
    `Workspace validation failed with ${issues.length} ${noun}:`,
    ...issues.map((item) => `- [${item.code}] ${item.path}: ${item.message}`),
  ].join('\n');
}

/**
 * Run the workspace validator CLI.
 *
 * @param {{ rootPath?: string, stdout?: NodeJS.WritableStream, stderr?: NodeJS.WritableStream }} options
 * @returns {Promise<number>} process exit code
 */
export async function runCli(options = {}) {
  const rootPath = options.rootPath ?? process.cwd();
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;

  try {
    const snapshot = await discoverWorkspace(rootPath);
    const issues = validateWorkspace(snapshot);
    if (issues.length > 0) {
      stderr.write(`${formatValidationIssues(issues)}\n`);
      return 1;
    }

    stdout.write(`Workspace validation passed for ${snapshot.packages.length} packages.\n`);
    return 0;
  } catch (error) {
    stderr.write(`Workspace validation could not run: ${errorMessage(error)}\n`);
    return 2;
  }
}

async function executePnpmList(rootPath) {
  const pnpmArguments = ['list', '--recursive', '--depth', '-1', '--json'];
  const executable = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'pnpm';
  const arguments_ =
    process.platform === 'win32' ? ['/d', '/s', '/c', 'pnpm.cmd', ...pnpmArguments] : pnpmArguments;
  const { stdout } = await execFile(executable, arguments_, {
    cwd: rootPath,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    windowsHide: true,
  });
  return stdout;
}

async function readJsonFile(filePath) {
  const source = await readFile(filePath, 'utf8');
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`${filePath} is not valid JSON: ${errorMessage(error)}`, { cause: error });
  }
}

async function readOptionalFile(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (isMissingPathError(error)) return null;
    throw error;
  }
}

async function containsTestFiles(directoryPath) {
  try {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    return entries.some((entry) => entry.isFile() && TEST_FILE_PATTERN.test(entry.name));
  } catch (error) {
    if (isMissingPathError(error)) return false;
    throw error;
  }
}

function validateRequiredScript(scripts, scriptName, packageJsonPath, issues) {
  if (!stringProperty(scripts, scriptName)) {
    issues.push(
      issue('MISSING_PACKAGE_SCRIPT', packageJsonPath, `missing required ${scriptName} script`),
    );
  }
}

function validateDuplicateValues(items, selectValue, code, label, issues) {
  const firstPathByValue = new Map();
  for (const item of items) {
    const value = selectValue(item);
    const firstPath = firstPathByValue.get(value);
    if (firstPath) {
      issues.push(
        issue(
          code,
          `${item.path}/package.json`,
          `${label} ${value} is already used by ${firstPath}`,
        ),
      );
    } else {
      firstPathByValue.set(value, `${item.path}/package.json`);
    }
  }
}

function issue(code, issuePath, message) {
  return { code, path: issuePath, message };
}

function stringProperty(record, property) {
  const value = record[property];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function sortedUnique(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function normalizeWorkspacePath(value) {
  return normalizeRelativePath(value).replace(/^\.\//u, '').replace(/\/$/u, '');
}

function normalizeRelativePath(value) {
  return value.replace(/\\/gu, '/');
}

function normalizedAbsolutePath(value) {
  const normalized = path.normalize(path.resolve(value));
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isMissingPathError(error) {
  return isRecord(error) && error.code === 'ENOENT';
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function isCliEntryPoint(moduleUrl, argvPath) {
  if (!argvPath) return false;
  return normalizedAbsolutePath(fileURLToPath(moduleUrl)) === normalizedAbsolutePath(argvPath);
}

if (isCliEntryPoint(import.meta.url, process.argv[1])) {
  process.exitCode = await runCli();
}

/**
 * @typedef {object} PnpmWorkspaceRecord
 * @property {string} name
 * @property {string} path
 */

/**
 * @typedef {object} WorkspacePackage
 * @property {string} name
 * @property {string} path
 * @property {Record<string, unknown>} packageJson
 * @property {boolean} hasTsConfig
 * @property {boolean} hasTests
 */

/**
 * @typedef {object} WorkspaceSnapshot
 * @property {string} rootPath
 * @property {Record<string, unknown>} rootPackageJson
 * @property {WorkspacePackage[]} packages
 * @property {string[]} tsconfigReferences
 * @property {string[]} vitestProjects
 */

/**
 * @typedef {object} ValidationIssue
 * @property {string} code
 * @property {string} path
 * @property {string} message
 */
