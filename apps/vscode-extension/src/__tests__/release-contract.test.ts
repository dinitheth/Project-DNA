import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

interface ReleaseContract {
  readonly extension: {
    readonly publisher: string;
    readonly name: string;
    readonly id: string;
    readonly version: string;
    readonly activationEvents: readonly string[];
    readonly vscodeEngine: string;
    readonly apiFloor: string;
    readonly typesPackage: string;
    readonly extensionKind: readonly string[];
    readonly untrustedWorkspaces: { readonly supported: true };
    readonly virtualWorkspaces: { readonly supported: false };
  };
  readonly runtime: {
    readonly toolchainNode: string;
    readonly toolchainNodeRange: string;
    readonly packageManager: string;
    readonly electron: { readonly version: string; readonly abi: string };
    readonly electronCompatibility: { readonly versions: readonly string[]; readonly abi: string };
    readonly remoteNode: { readonly version: string; readonly abi: string };
    readonly nativeBuild: {
      readonly betterSqlite3: string;
      readonly electronRebuild: string;
    };
    readonly packaging: { readonly vsce: string; readonly sourceDateEpoch: string };
    readonly bindingResolutionInputs: readonly string[];
    readonly allowAbiFallback: boolean;
    readonly allowRuntimeDownload: boolean;
    readonly allowRuntimeCompilation: boolean;
  };
  readonly platforms: {
    readonly local: readonly string[];
    readonly remote: readonly string[];
    readonly remoteEnvironments: readonly string[];
    readonly linuxMinimumGlibc: string;
    readonly unsupported: readonly string[];
  };
  readonly remoteValidation: {
    readonly required: boolean;
    readonly realVscodeServerExtensionHost: boolean;
    readonly baseOs: string;
    readonly architecture: string;
    readonly minimumGlibc: string;
    readonly vscodeVersion: string;
    readonly installedVsixRequired: boolean;
    readonly nodeOnlySmokeTestIsSufficient: boolean;
  };
  readonly compatibilityValidation: {
    readonly manifestEngine: string;
    readonly validatedRange: string;
    readonly desktopVersions: readonly string[];
    readonly remoteServerVersions: readonly string[];
    readonly electronRuntimes: ReadonlyArray<{ readonly version: string; readonly abi: string }>;
  };
  readonly vsix: {
    readonly dependencies: boolean;
    readonly marketplaceTargets: readonly string[];
    readonly allowedApplicationFiles: readonly string[];
    readonly requiredApplicationFiles: readonly string[];
    readonly allowedTreeSitterFiles: readonly string[];
    readonly sqliteRuntimeAllowlistDeferred: boolean;
    readonly allowedSqliteFiles: readonly string[];
    readonly nativeBindings: Readonly<Record<string, readonly string[]>>;
    readonly forbiddenContents: readonly string[];
  };
  readonly unsupportedRuntimeBehavior: Readonly<Record<string, boolean | string>>;
  readonly runners: Readonly<Record<string, string>>;
  readonly marketplaceMetadata: { readonly deferred: readonly string[] };
}

interface PackageManifest {
  readonly name: string;
  readonly publisher: string;
  readonly version: string;
  readonly engines: { readonly vscode: string };
  readonly activationEvents: readonly string[];
  readonly extensionKind: readonly string[];
  readonly capabilities: {
    readonly untrustedWorkspaces: { readonly supported: true };
    readonly virtualWorkspaces: { readonly supported: false };
  };
  readonly dependencies: { readonly 'better-sqlite3': string };
  readonly devDependencies: {
    readonly '@electron/rebuild': string;
    readonly '@types/vscode': string;
    readonly '@vscode/vsce': string;
    readonly playwright: string;
  };
  readonly scripts: {
    readonly 'build:native': string;
    readonly 'package:vsix': string;
    readonly stage: string;
    readonly integrity: string;
    readonly 'validate:package': string;
    readonly 'validate:installed-server': string;
    readonly 'validate:installed-desktop': string;
  };
}

const extensionRoot = path.resolve(__dirname, '../../');
const repositoryRoot = path.resolve(extensionRoot, '../..');
const rootPackage = readJson<{
  readonly packageManager: string;
  readonly engines: { readonly node: string };
}>('../../package.json');
const extensionPackage = readJson<PackageManifest>('./package.json');
const contract = readJson<ReleaseContract>('./release-contract.json');
const nodeVersion = readFileSync(path.resolve(extensionRoot, '../../.node-version'), 'utf8').trim();
const lockfile = readFileSync(
  path.resolve(extensionRoot, '../../pnpm-lock.yaml'),
  'utf8',
).replaceAll('\r\n', '\n');
const nativeRuntimeSource = readText('./src/runtime/native-runtime.ts');
const extensionSource = readText('./src/extension.ts');
const containerSource = readText('./src/container.ts');
const storageSource = readText('../../packages/storage/src/sqlite-storage.ts');
const nativeBuildScript = readText('./scripts/build-native.mjs');
const stagingScript = readText('./scripts/stage-extension.mjs');
const integrityScript = readText('./scripts/create-integrity-manifest.mjs');
const packageValidationScript = readText('./scripts/validate-package.mjs');
const installedServerValidationScript = readText('./scripts/validate-installed-vsix-server.mjs');
const installedDesktopValidationScript = readText('./scripts/validate-installed-vsix-desktop.mjs');
const installedDesktopValidationHelpers = readText(
  './scripts/installed-desktop-validation-helpers.mjs',
);
const installedDriverPackage = readJson<{
  readonly engines: { readonly vscode: string };
  readonly extensionKind: readonly string[];
  readonly activationEvents: readonly string[];
  readonly main: string;
}>('./test/installed-vsix-driver/package.json');
const installedDriverSource = readText('./test/installed-vsix-driver/extension.cjs');
const nativeWorkflow = readFileSync(
  path.resolve(extensionRoot, '../../.github/workflows/native-build.yml'),
  'utf8',
).replaceAll('\r\n', '\n');
const thirdPartyNotices = readFileSync(path.resolve(extensionRoot, 'THIRD_PARTY_NOTICES.txt'));

describe('M5 release contract', () => {
  it('matches the frozen toolchain contract', () => {
    expect(nodeVersion).toBe(contract.runtime.toolchainNode);
    expect(rootPackage.engines.node).toBe(contract.runtime.toolchainNodeRange);
    expect(rootPackage.packageManager).toBe(contract.runtime.packageManager);
    expect(contract.runtime.toolchainNode).toBe('22.23.2');
    expect(contract.runtime.packageManager).toBe('pnpm@9.15.4');
    expect(contract.runtime.remoteNode).toEqual({ version: '24.19.0', abi: '137' });
    expect(extensionPackage.devDependencies['@electron/rebuild']).toBe('4.2.0');
    expect(extensionPackage.devDependencies['@vscode/vsce']).toBe('3.9.2');
    expect(extensionPackage.devDependencies.playwright).toBe('1.62.1');
    expect(extensionPackage.dependencies['better-sqlite3']).toBe('^12.11.1');
    expect(lockfile).toContain("'@electron/rebuild@4.2.0':");
    expect(lockfile).toContain("'@vscode/vsce@3.9.2':");
    expect(lockfile).toContain('playwright@1.62.1:');
    expect(lockfile).toContain('better-sqlite3@12.11.1:');
  });

  it('matches the frozen extension identity and activation contract', () => {
    expect(extensionPackage.publisher).toBe(contract.extension.publisher);
    expect(extensionPackage.name).toBe(contract.extension.name);
    expect(`${extensionPackage.publisher}.${extensionPackage.name}`).toBe(contract.extension.id);
    expect(extensionPackage.version).toBe(contract.extension.version);
    expect(extensionPackage.activationEvents).toEqual(contract.extension.activationEvents);
  });

  it('matches the frozen VS Code runtime and API contract', () => {
    expect(extensionPackage.engines.vscode).toBe(contract.extension.vscodeEngine);
    expect(contract.extension.vscodeEngine).toBe('>=1.132.0');
    expect(contract.compatibilityValidation).toEqual({
      manifestEngine: '>=1.132.0',
      validatedRange: '>=1.132.0 <1.133.1',
      desktopVersions: ['1.132.0', '1.132.1', '1.133.0'],
      remoteServerVersions: ['1.132.0', '1.132.1', '1.133.0'],
      electronRuntimes: [
        { version: '42.7.1', abi: '146' },
        { version: '42.8.0', abi: '146' },
      ],
    });
    expect(extensionPackage.devDependencies['@types/vscode']).toBe(contract.extension.typesPackage);
    expect(contract.extension.apiFloor).toBe('1.100.0');
    expect(lockfile).toContain('specifier: 1.100.0\n        version: 1.100.0');
    expect(lockfile).toContain("'@types/vscode@1.100.0':");
    expect(lockfile).not.toContain("'@types/vscode@1.125.0':");
  });

  it('matches the frozen workspace capabilities', () => {
    expect(extensionPackage.extensionKind).toEqual(contract.extension.extensionKind);
    expect(extensionPackage.capabilities).toEqual({
      untrustedWorkspaces: { supported: true },
      virtualWorkspaces: { supported: false },
    });
  });

  it('contains the exact frozen platform, ABI, and runner matrix', () => {
    expect(contract.platforms.local).toEqual([
      'win32-x64',
      'linux-x64',
      'darwin-x64',
      'darwin-arm64',
    ]);
    expect(contract.platforms.remote).toEqual(['linux-x64']);
    expect(contract.platforms.remoteEnvironments).toEqual([
      'remote-ssh',
      'wsl2',
      'dev-containers',
      'codespaces',
    ]);
    expect(contract.platforms.linuxMinimumGlibc).toBe('2.35');
    expect(contract.runtime.electron).toEqual({ version: '42.7.1', abi: '146' });
    expect(contract.runtime.electronCompatibility).toEqual({
      versions: ['42.7.1', '42.8.0'],
      abi: '146',
    });
    expect(contract.runtime.remoteNode).toEqual({ version: '24.19.0', abi: '137' });
    expect(contract.runtime.nativeBuild).toEqual({
      betterSqlite3: '12.11.1',
      electronRebuild: '4.2.0',
    });
    expect(contract.runtime.packaging).toEqual({
      vsce: '3.9.2',
      sourceDateEpoch: '315532800',
    });
    expect(contract.runners).toEqual({
      'win32-x64': 'windows-2025',
      'linux-x64': 'ubuntu-22.04',
      'darwin-x64': 'macos-15-intel',
      'darwin-arm64': 'macos-15',
    });
    expect(contract.vsix.nativeBindings).toEqual({
      'win32-x64': ['native/win32-x64/electron-abi146/better_sqlite3.node'],
      'linux-x64': [
        'native/linux-x64/electron-abi146/better_sqlite3.node',
        'native/linux-x64/node-abi137/better_sqlite3.node',
      ],
      'darwin-x64': ['native/darwin-x64/electron-abi146/better_sqlite3.node'],
      'darwin-arm64': ['native/darwin-arm64/electron-abi146/better_sqlite3.node'],
    });
    expect(contract.vsix.marketplaceTargets).toEqual([
      'win32-x64',
      'linux-x64',
      'darwin-x64',
      'darwin-arm64',
    ]);
    expect(new Set(contract.vsix.marketplaceTargets)).toEqual(
      new Set(Object.keys(contract.vsix.nativeBindings)),
    );
  });

  it('contains the frozen remote validation and VSIX delivery contract', () => {
    expect(contract.remoteValidation).toEqual({
      required: true,
      realVscodeServerExtensionHost: true,
      baseOs: 'ubuntu-22.04',
      architecture: 'linux-x64',
      minimumGlibc: '2.35',
      vscodeVersion: '>=1.132.0',
      installedVsixRequired: true,
      nodeOnlySmokeTestIsSufficient: false,
    });
    expect(contract.vsix.dependencies).toBe(false);
    for (const relativePath of contract.vsix.requiredApplicationFiles) {
      expect(contract.vsix.allowedApplicationFiles).toContain(relativePath);
    }
    for (const relativePath of contract.vsix.requiredApplicationFiles) {
      const sourceRoot = relativePath === 'LICENSE.txt' ? repositoryRoot : extensionRoot;
      const sourcePath = relativePath === 'LICENSE.txt' ? 'LICENSE' : relativePath;
      expect(readFileIfPresent(sourceRoot, sourcePath), relativePath).toBe(true);
    }
    expect(contract.vsix.allowedApplicationFiles).not.toContain('resources/marketplace-icon.png');
    expect(contract.vsix.allowedApplicationFiles).not.toContain('media/overview.png');
    expect(contract.vsix.allowedApplicationFiles).not.toContain('media/architecture.png');
    expect(contract.vsix.allowedApplicationFiles).not.toContain('media/risks.png');
    expect(contract.vsix.allowedApplicationFiles).not.toContain('README.md');
    expect(contract.vsix.allowedApplicationFiles).not.toContain('CHANGELOG.md');
    expect(contract.vsix.allowedApplicationFiles).toContain('LICENSE.txt');
    expect(contract.vsix.requiredApplicationFiles).toContain('LICENSE.txt');
    expect(contract.vsix.allowedApplicationFiles).toContain('THIRD_PARTY_NOTICES.txt');
    expect(contract.vsix.requiredApplicationFiles).toContain('THIRD_PARTY_NOTICES.txt');
    expect(readText('../../LICENSE')).toContain('MIT License');
    expect(thirdPartyNotices.toString('utf8')).toContain('PROJECT DNA THIRD-PARTY NOTICES');
    expect(thirdPartyNotices.toString('utf8')).toContain('better-sqlite3 12.11.1');
    expect(thirdPartyNotices.toString('utf8')).toContain('TypeScript 5.6.2');
    expect(thirdPartyNotices.toString('utf8')).toContain('tree-sitter-rust 0.20.4');
    expect(createHash('sha256').update(thirdPartyNotices).digest('hex')).toBe(
      '834d1e263deeddf783411850534cd53e71e15f3a3bcb8f65c4770de389c05dc8',
    );
    expect(contract.vsix.allowedApplicationFiles).not.toContain('SECURITY.md');
    expect(contract.vsix.allowedApplicationFiles).not.toContain('SUPPORT.md');
    expect(contract.vsix.allowedApplicationFiles).not.toContain('THIRD_PARTY_NOTICES.md');
    expect(contract.vsix.allowedApplicationFiles).toContain('dist/ast-worker.js');
    expect(contract.vsix.allowedTreeSitterFiles).toContain(
      'node_modules/web-tree-sitter/tree-sitter.wasm',
    );
    expect(contract.vsix.nativeBindings['linux-x64']).toEqual([
      'native/linux-x64/electron-abi146/better_sqlite3.node',
      'native/linux-x64/node-abi137/better_sqlite3.node',
    ]);
    expect(contract.vsix.sqliteRuntimeAllowlistDeferred).toBe(false);
    expect(contract.vsix.allowedSqliteFiles).toEqual([
      'node_modules/better-sqlite3/package.json',
      'node_modules/better-sqlite3/lib/index.js',
      'node_modules/better-sqlite3/lib/database.js',
      'node_modules/better-sqlite3/lib/sqlite-error.js',
      'node_modules/better-sqlite3/lib/util.js',
      'node_modules/better-sqlite3/lib/methods/aggregate.js',
      'node_modules/better-sqlite3/lib/methods/backup.js',
      'node_modules/better-sqlite3/lib/methods/function.js',
      'node_modules/better-sqlite3/lib/methods/inspect.js',
      'node_modules/better-sqlite3/lib/methods/pragma.js',
      'node_modules/better-sqlite3/lib/methods/serialize.js',
      'node_modules/better-sqlite3/lib/methods/table.js',
      'node_modules/better-sqlite3/lib/methods/transaction.js',
      'node_modules/better-sqlite3/lib/methods/wrappers.js',
    ]);
    expect(contract.vsix.forbiddenContents).toContain('workspace:*');
    expect(contract.vsix.forbiddenContents).toContain('source-maps');
  });

  it('contains the frozen native selection and safe failure contract', () => {
    expect(contract.runtime.bindingResolutionInputs).toEqual([
      'process.platform',
      'process.arch',
      'process.versions.modules',
      'process.versions.electron',
    ]);
    expect(contract.runtime.allowAbiFallback).toBe(false);
    expect(contract.runtime.allowRuntimeDownload).toBe(false);
    expect(contract.runtime.allowRuntimeCompilation).toBe(false);
    expect(contract.unsupportedRuntimeBehavior).toMatchObject({
      resolveBeforeStorage: true,
      createDatabase: false,
      runMigrations: false,
      startWatcher: false,
      startWorkers: false,
      publishSnapshots: false,
      preserveExistingDatabase: true,
    });
    expect(nativeRuntimeSource).toContain('process.versions.modules');
    expect(nativeRuntimeSource).toContain('process.versions.electron');
    expect(nativeRuntimeSource).toContain("new Set(['42.7.1', '42.8.0'])");
    expect(nativeRuntimeSource).toContain("const ELECTRON_ABI = '146'");
    expect(nativeRuntimeSource).toContain("const NODE_ABI = '137'");
    expect(extensionSource.indexOf('resolveNativeBinding(')).toBeLessThan(
      extensionSource.indexOf('createContainer({'),
    );
    expect(containerSource).toContain('nativeBinding: resolved.nativeBindingPath');
    expect(storageSource).toContain(
      'new Database(dbPath, { nativeBinding: options.nativeBinding })',
    );
    expect(storageSource).not.toContain("require('bindings')");
  });

  it('encodes deterministic native build, staging, integrity, and VSIX packaging requirements', () => {
    expect(nativeBuildScript).toContain("const ELECTRON_VERSION = '42.7.1'");
    expect(nativeBuildScript).toContain("const ELECTRON_ABI = '146'");
    expect(nativeBuildScript).toContain("const NODE_VERSION = 'v24.19.0'");
    expect(nativeBuildScript).toContain("const NODE_HEADERS_VERSION = '24.18.0'");
    expect(nativeBuildScript).toContain("const NODE_ABI = '137'");
    expect(nativeBuildScript).toContain('`--target=${NODE_HEADERS_VERSION}`');
    expect(nativeBuildScript).toContain("'--only',");
    expect(nativeBuildScript).toContain("'better-sqlite3',");
    expect(nativeBuildScript).toContain("'--build-from-source',");
    expect(nativeBuildScript).toContain("'--force',");
    expect(nativeBuildScript).toContain('process.env.RUNNER_TEMP ?? os.tmpdir()');
    expect(nativeBuildScript).toContain("'project-dna-native-build'");
    expect(nativeBuildScript).toContain("'--module-dir',");
    expect(nativeBuildScript).toContain("'.',");
    expect(nativeBuildScript).toContain("{ cwd: moduleDir, stdio: 'inherit' }");
    expect(nativeBuildScript).toContain('`electron-abi${ELECTRON_ABI}`');
    expect(nativeBuildScript).toContain("db.pragma('quick_check',{simple:true})");

    expect(stagingScript).toContain('contract.vsix.allowedApplicationFiles');
    expect(stagingScript).toContain('contract.vsix.allowedTreeSitterFiles');
    expect(stagingScript).toContain('SQLITE_FILES');
    expect(stagingScript).toContain('contract.vsix.nativeBindings[target]');
    expect(stagingScript).toContain('normalizeStagingTree(stagingRoot)');
    expect(stagingScript).toContain('delete manifest.devDependencies');
    expect(stagingScript).toContain("['better-sqlite3', 'web-tree-sitter', 'tree-sitter-wasms']");

    for (const field of [
      'extensionId',
      'version',
      'target',
      'platform',
      'architecture',
      'runtime',
      'abi',
      'toolchain',
      'buildCommit',
      'files',
      'packageSha256',
    ]) {
      expect(`${integrityScript}\n${packageValidationScript}`).toContain(field);
    }
    expect(packageValidationScript).toContain('staging-a');
    expect(packageValidationScript).toContain('staging-b');
    expect(packageValidationScript).toContain('validateManifestForPackaging');
    expect(packageValidationScript).toContain('createDefaultProcessors');
    expect(packageValidationScript).toContain('processFiles');
    expect(packageValidationScript).toContain("vsceRequire('yazl')");
    expect(packageValidationScript).toContain('stagedFiles: validatedA.files');
    expect(packageValidationScript).toContain('stagedFiles: validatedB.files');
    expect(packageValidationScript).not.toContain("'--dependencies'");
    expect(packageValidationScript).not.toContain("'--no-dependencies'");
    expect(packageValidationScript).toContain('SOURCE_DATE_EPOCH');
    expect(packageValidationScript).toContain('comparePackages(vsixA, vsixB)');
    expect(extensionPackage.scripts['build:native']).toBe('node scripts/build-native.mjs');
    expect(extensionPackage.scripts['package:vsix']).toContain(
      'node scripts/validate-package.mjs --package',
    );
  });

  it('encodes the frozen GitHub-hosted native build matrix', () => {
    for (const requiredValue of [
      'windows-2025',
      'ubuntu-22.04',
      'macos-15-intel',
      'macos-15',
      'win32-x64',
      'linux-x64',
      'darwin-x64',
      'darwin-arm64',
      'node: 22.23.2',
      'builder-node: 24.19.0',
      'NATIVE_RUNTIME: ${{ matrix.runtime }}',
      'pnpm install --frozen-lockfile',
      'pnpm build:native',
      'pnpm package:vsix',
      'node scripts/validate-package.mjs',
    ]) {
      expect(nativeWorkflow).toContain(requiredValue);
    }
    expect(nativeWorkflow.match(/runtime: electron/gu)).toHaveLength(4);
    expect(nativeWorkflow.match(/runtime: node/gu)).toHaveLength(1);
    expect(nativeWorkflow).toContain('test "$(node -p \'process.versions.modules\')" = "137"');
    expect(nativeWorkflow).toContain('SHASUMS256.txt');
    expect(nativeWorkflow).toContain('awk -v name="$archive" \'$2 == "*" name {print $1}\'');
    expect(nativeWorkflow).toContain("crypto.createHash('sha256')");
    expect(nativeWorkflow).toContain('fs.readFileSync(file)');
    expect(nativeWorkflow).not.toContain('actual="$(sha256sum');
    expect(nativeWorkflow).toContain('test "$(find native -type f -name better_sqlite3.node');
    expect(nativeWorkflow).toContain('unzip -t release/project-dna-a.vsix');
    expect(nativeWorkflow).toContain('name: package-${{ matrix.target }}');
    expect(nativeWorkflow).toContain('target: [win32-x64, linux-x64, darwin-x64, darwin-arm64]');
    expect(nativeWorkflow).toContain('pattern: native-${{ matrix.target }}-*');
    expect(nativeWorkflow).toContain('name: project-dna-vsix-${{ matrix.target }}');
    expect(nativeWorkflow).not.toMatch(/^\s+name: project-dna-vsix\s*$/mu);
    expect(nativeWorkflow).toContain('git config --global core.autocrlf false');
    expect(nativeWorkflow).toContain(
      'runtime_root="$RUNNER_TEMP/project-dna-electron-${NATIVE_TARGET}"',
    );
    expect(nativeWorkflow).not.toContain('$GITHUB_WORKSPACE/.electron-runtime');
    expect(nativeWorkflow.indexOf('Configure deterministic line endings')).toBeLessThan(
      nativeWorkflow.indexOf('uses: actions/checkout@v4'),
    );
  });

  it('requires installed VSIX validation in the official remote Extension Host', () => {
    expect(extensionPackage.scripts['validate:installed-server']).toBe(
      'node scripts/validate-installed-vsix-server.mjs',
    );
    expect(installedDriverPackage).toEqual({
      name: 'project-dna-installed-vsix-driver',
      displayName: 'Project DNA Installed VSIX Driver',
      description:
        'CI-only driver for validating Project DNA in an installed VS Code Extension Host.',
      version: '1.0.0',
      publisher: 'project-dna-tests',
      private: true,
      engines: { vscode: '>=1.132.0' },
      capabilities: { untrustedWorkspaces: { supported: true } },
      extensionKind: ['workspace'],
      activationEvents: ['onStartupFinished'],
      main: './extension.cjs',
    });

    for (const requiredWorkflowValue of [
      'installed-extension-host-linux-x64:',
      'needs: package',
      'runs-on: ubuntu-22.04',
      'timeout-minutes: 25',
      'name: project-dna-vsix-linux-x64',
      'path: apps/vscode-extension/release',
      'PLAYWRIGHT_BROWSERS_PATH: ${{ runner.temp }}/project-dna-playwright-1.62.1',
      'pnpm validate:installed-server',
      'if: failure()',
      '${{ runner.temp }}/project-dna-installed-server/logs',
    ]) {
      expect(nativeWorkflow).toContain(requiredWorkflowValue);
    }

    for (const requiredScriptValue of [
      "process.env.PROJECT_DNA_EXPECTED_VSCODE_VERSION ?? '1.132.0'",
      '/server-linux-x64-web/stable',
      'process.env.PROJECT_DNA_EXPECTED_VSCODE_SERVER_SHA256 ??',
      "'a49c72b8d9e47faceef53e366c65af1be159bf4818dcb77579241af28de0a7d6'",
      'const HARD_TIMEOUT_MS = 12 * 60 * 1000',
      "path.join('release', 'project-dna-a.vsix')",
      "requiredEnvironment('RUNNER_TEMP')",
      "requiredEnvironment('GITHUB_WORKSPACE')",
      "path.join(validationRoot, 'server-data')",
      "path.join(validationRoot, 'extensions')",
      "path.join(validationRoot, 'workspace')",
      "path.join(validationRoot, 'browser-profile')",
      "'--list-extensions'",
      "'--show-versions'",
      '`${PROJECT_EXTENSION_ID}@1.0.0`',
      '`${DRIVER_EXTENSION_ID}@1.0.0`',
      "'extensions.user.cache'",
      "'extensions.builtin.cache'",
      "'127.0.0.1'",
      "'--port'",
      "'0'",
      "randomBytes(32).toString('hex')",
      "await import('playwright')",
      'Web UI available at',
      'response.allHeaders()',
      'bodyPrefix',
      'detached: true',
      'process.kill(-child.pid, signal)',
      'Promise.allSettled(cleanupTasks)',
      'closePlaywright(resources.browserContext)',
      'terminateServer(resources.server)',
      'await cleanup(resources)',
      "process.env.VSIX_PATH ?? path.join('release', 'project-dna-a.vsix')",
      'integrity.files.find((file) => file.path === NATIVE_BINDING)',
    ]) {
      expect(installedServerValidationScript).toContain(requiredScriptValue);
    }
    expect(installedServerValidationScript.indexOf('verifyVsixIntegrity({')).toBeLessThan(
      installedServerValidationScript.indexOf("'--install-extension'"),
    );
    expect(installedServerValidationScript).toContain(
      'for (const extension of [vsixPath, paths.driverVsix])',
    );
    expect(installedServerValidationScript).not.toContain(
      "'--start-server',\n      '--install-extension',\n      paths.driverVsix,",
    );
    expect(installedServerValidationScript).not.toContain('--extensionDevelopmentPath');
    expect(installedServerValidationScript).not.toContain('@vscode/test-electron');
    expect(installedServerValidationScript).not.toContain('@vscode/test-cli');

    for (const requiredDriverValue of [
      "process.env.PROJECT_DNA_EXPECTED_VSCODE_VERSION ?? '1.132.0'",
      "process.env.PROJECT_DNA_EXPECTED_PLATFORM ?? 'linux'",
      "process.env.PROJECT_DNA_EXPECTED_ARCHITECTURE ?? 'x64'",
      "process.env.PROJECT_DNA_EXPECTED_MODULES ?? '137'",
      'assertEqual(vscode.version, EXPECTED_VSCODE_VERSION',
      'assertEqual(process.platform, EXPECTED_PLATFORM',
      'assertEqual(process.arch, EXPECTED_ARCHITECTURE',
      'assertEqual(process.versions.modules, EXPECTED_MODULES',
      'process.versions.electron === undefined',
      'vscode.env.remoteName',
      "'native/linux-x64/node-abi137/better_sqlite3.node'",
      'assertPathOutside(installedExtensionPath, repositoryWorkspace',
      "JSON.stringify(['workspace'])",
      'await projectExtension.activate()',
      "vscode.commands.executeCommand('project-dna.analyzeRepository')",
      'const COMMAND_TIMEOUT_MS = 30_000',
      "'project-dna.analyzeRepository failed to resolve within 30 seconds'",
      "'project-dna.sqlite'",
      "const SQLITE_HEADER_HEX = '53514c69746520666f726d6174203300'",
      'rowsAfter > rowsBefore',
      'nativeBinding: bindingPath',
      "path.join(context.globalStorageUri.fsPath, 'installed-extension-host.json')",
      "require('./path-utils.cjs')",
      'sameFilesystemPath(actualWorkspace, fixtureWorkspace)',
    ]) {
      expect(installedDriverSource).toContain(requiredDriverValue);
    }
    expect(installedDriverSource).not.toContain(
      "assertEqual(realpathSync(workspaceFolder), fixtureWorkspace, 'fixture workspace path')",
    );
    expect(installedDriverSource).not.toContain(
      "requiredEnvironment('PROJECT_DNA_INSTALLED_TEST_RESULT')",
    );
  });

  it('encodes the unreleased installed-VSIX compatibility matrix', () => {
    expect(extensionPackage.scripts['validate:installed-desktop']).toBe(
      'node scripts/validate-installed-vsix-desktop.mjs',
    );
    for (const requiredScriptValue of [
      'const HARD_TIMEOUT_MS = 12 * 60 * 1000',
      "requiredEnvironment('RUNNER_TEMP')",
      "requiredEnvironment('GITHUB_WORKSPACE')",
      "process.env.VSIX_PATH ?? path.join('release', 'project-dna-a.vsix')",
      "process.env.INTEGRITY_PATH ?? path.join('release', 'integrity.json')",
      "'--install-extension'",
      "'--list-extensions'",
      "'--show-versions'",
      "'Contents', 'Resources', 'app', 'bin', 'code'",
      "'Contents', 'MacOS', 'Code'",
      "path.basename(path.dirname(candidate)) === 'bin'",
      "path.basename(candidate).toLowerCase() === 'code.cmd'",
      "path.basename(candidate) === 'cli.js'",
      "path.basename(path.dirname(path.dirname(path.dirname(candidate)))) === 'resources'",
      "ELECTRON_RUN_AS_NODE: '1'",
      'process=${label} status=creating',
      'process=${label} status=output',
      'process=${label} status=exit',
      'process=${label} cleanup=start',
      'headers.Range = `bytes=${existingSize}-`',
      "response.headers.get('content-range')",
      'download failed after ${maxAttempts} attempts',
      'desktop validation failed during ${name}',
      'stage=${name} status=start',
      'runWithCleanup(',
      "'official archive download'",
      "'official archive extraction'",
      "'official executable discovery'",
      'extension installation (',
      "'extension listing'",
      "'client launch'",
      'PROJECT_DNA_EXPECTED_ELECTRON_VERSION',
      "PROJECT_DNA_EXPECTED_MODULES: '146'",
      'PROJECT_DNA_EXPECTED_NATIVE_BINDING',
      'PROJECT_DNA_EXPECTED_REMOTE',
      "vscode.commands.executeCommand('project-dna.analyzeRepository')",
      'integrity.files.find((file) => file.path === nativeBinding)',
      "process.kill(-client.pid, 'SIGTERM')",
      "process.kill(-client.pid, 'SIGKILL')",
      "spawn('taskkill', ['/pid', String(client.pid), '/t', '/f']",
      'Promise.allSettled(cleanupTasks)',
    ]) {
      expect(
        `${installedDesktopValidationScript}\n${installedDesktopValidationHelpers}\n${installedDriverSource}`,
      ).toContain(requiredScriptValue);
    }
    expect(installedDesktopValidationScript).not.toContain('--extensionDevelopmentPath');
    expect(installedDesktopValidationScript).not.toContain('@vscode/test-electron');
    expect(installedDesktopValidationScript).not.toContain('@vscode/test-cli');

    for (const requiredWorkflowValue of [
      'compatibility-desktop:',
      'compatibility-remote-linux-x64:',
      'needs: package',
      'timeout-minutes: 25',
      'PROJECT_DNA_EXPECTED_TARGET',
      'PROJECT_DNA_EXPECTED_VSCODE_VERSION',
      'PROJECT_DNA_VSCODE_ARCHIVE_SHA256',
      'PROJECT_DNA_EXPECTED_ELECTRON_VERSION',
      'pnpm validate:installed-desktop',
      'pnpm validate:installed-server',
      '98bd4a4721a5bd8534dbad8eaf9801f001ee36703a278c5d52d6036df8c7e503',
      '405f9e096b2cd9489a35c4c458c38badcf10374b64c529a6a9cab3c0e5463172',
      '2073ae64f09564ab76c583c5553e2c76de96e4d78efc27e4e9aaec8430bf5229',
      'acdaf0fa557bda1720956ff65ca0de0965e92d68f97e2db22341984400937aed',
      '78a84fdf4cf756b3110623c8d1dce96c582613fe71d15a6a3f1343619092c04e',
      '2bf1a90d2f008af009eb3c4a7bd0849b9247a0588cd39a404a0b1e691be68161',
      '1fb68a8a6357190942a36623ca784937b1226b0b5508a6281aa6fe5328c58db6',
      '95ebef891aefe998d9879a559c399a55dfadcb0aeebb48de75d1dda5de79f379',
      '8fa12ce73e5c3ea5fe3927227047ac483a0ced4f9048cdc8bae7332761c3e415',
      '8f5874dc1fee62f24153a1a9a5f4c3f10bbcc28ff9e8a04fc9f4cdcb6d9d0f6e',
      '57ba6dfc904df79a42b0ce4247a32e8d7400f760b4bd6e608685943c01f4d93d',
      '2b13ff21f640af3b1be9cf2c267fd5f0175f67004ec6e1263535600f382bf42d',
      '80f56351be85cbd696f141f50086dce289fb07b8fd3ed67f092a1cb56c7032a8',
      'afdfd9868c417e9df7df4bc50ea87663fcd22bdbfab4e930357be8b49b5a5c20',
    ]) {
      expect(nativeWorkflow).toContain(requiredWorkflowValue);
    }
    expect(nativeWorkflow.match(/vscode_version: 1\.132\.0/gu)).toHaveLength(4);
    expect(nativeWorkflow.match(/vscode_version: 1\.132\.1/gu)).toHaveLength(5);
    expect(nativeWorkflow.match(/vscode_version: 1\.133\.0/gu)).toHaveLength(5);
  });

  it('keeps unspecified Marketplace metadata deferred', () => {
    expect(contract.marketplaceMetadata.deferred).toEqual([
      'categories',
      'keywords',
      'repository',
      'homepage',
      'bugs',
      'pricing',
      'icon',
    ]);
    expect(extensionPackage).not.toHaveProperty('icon');
    expect(extensionPackage).not.toHaveProperty('categories');
    expect(extensionPackage).not.toHaveProperty('keywords');
    expect(extensionPackage).not.toHaveProperty('repository');
    expect(extensionPackage).not.toHaveProperty('homepage');
    expect(extensionPackage).not.toHaveProperty('bugs');
    expect(extensionPackage).not.toHaveProperty('pricing');
  });
});

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(path.resolve(extensionRoot, relativePath), 'utf8')) as T;
}

function readText(relativePath: string): string {
  return readFileSync(path.resolve(extensionRoot, relativePath), 'utf8').replaceAll('\r\n', '\n');
}

function readFileIfPresent(sourceRoot: string, relativePath: string): boolean {
  try {
    readFileSync(path.resolve(sourceRoot, relativePath));
    return true;
  } catch {
    return false;
  }
}
