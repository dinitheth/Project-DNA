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
  readonly vsix: {
    readonly dependencies: boolean;
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
  };
}

const extensionRoot = path.resolve(__dirname, '../../');
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
  });

  it('contains the frozen remote validation and VSIX delivery contract', () => {
    expect(contract.remoteValidation).toEqual({
      required: true,
      realVscodeServerExtensionHost: true,
      baseOs: 'ubuntu-22.04',
      architecture: 'linux-x64',
      minimumGlibc: '2.35',
      vscodeVersion: '1.132.x',
      installedVsixRequired: true,
      nodeOnlySmokeTestIsSufficient: false,
    });
    expect(contract.vsix.dependencies).toBe(false);
    for (const relativePath of contract.vsix.requiredApplicationFiles) {
      expect(contract.vsix.allowedApplicationFiles).toContain(relativePath);
    }
    for (const relativePath of contract.vsix.requiredApplicationFiles) {
      expect(readFileIfPresent(relativePath), relativePath).toBe(true);
    }
    expect(contract.vsix.allowedApplicationFiles).not.toContain('resources/marketplace-icon.png');
    expect(contract.vsix.allowedApplicationFiles).not.toContain('media/overview.png');
    expect(contract.vsix.allowedApplicationFiles).not.toContain('media/architecture.png');
    expect(contract.vsix.allowedApplicationFiles).not.toContain('media/risks.png');
    expect(contract.vsix.allowedApplicationFiles).not.toContain('README.md');
    expect(contract.vsix.allowedApplicationFiles).not.toContain('CHANGELOG.md');
    expect(contract.vsix.allowedApplicationFiles).not.toContain('LICENSE');
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
    expect(nativeRuntimeSource).toContain("const ELECTRON_VERSION = '42.7.1'");
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
    expect(nativeBuildScript).toContain("const NODE_ABI = '137'");
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
        'CI-only driver for validating Project DNA in an installed VS Code Server Extension Host.',
      version: '1.0.0',
      publisher: 'project-dna-tests',
      private: true,
      engines: { vscode: '1.132.x' },
      extensionKind: ['workspace'],
      activationEvents: ['onStartupFinished'],
      main: './extension.cjs',
    });

    for (const requiredWorkflowValue of [
      'installed-extension-host-linux-x64:',
      'needs: package',
      'runs-on: ubuntu-22.04',
      'timeout-minutes: 25',
      'name: project-dna-vsix',
      'path: apps/vscode-extension/release',
      'PLAYWRIGHT_BROWSERS_PATH: ${{ runner.temp }}/project-dna-playwright-1.62.1',
      'pnpm validate:installed-server',
      'if: failure()',
      '${{ runner.temp }}/project-dna-installed-server/logs',
    ]) {
      expect(nativeWorkflow).toContain(requiredWorkflowValue);
    }

    for (const requiredScriptValue of [
      "const VSCODE_VERSION = '1.132.0'",
      '/server-linux-x64/stable',
      "const VSCODE_SERVER_SHA256 = 'adf5816366a9a8c430745f96fd783df70e7606a35311999aac53b70b257aebc0'",
      'const HARD_TIMEOUT_MS = 12 * 60 * 1000',
      "path.join('release', 'project-dna-a.vsix')",
      "requiredEnvironment('RUNNER_TEMP')",
      "requiredEnvironment('GITHUB_WORKSPACE')",
      "path.join(validationRoot, 'server-data')",
      "path.join(validationRoot, 'extensions')",
      "path.join(validationRoot, 'workspace')",
      "path.join(validationRoot, 'browser-profile')",
      "'127.0.0.1'",
      "'--port'",
      "'0'",
      "randomBytes(32).toString('hex')",
      "await import('playwright')",
      'await cleanup(resources)',
      "process.env.VSIX_PATH ?? path.join('release', 'project-dna-a.vsix')",
      'integrity.files.find((file) => file.path === NATIVE_BINDING)',
    ]) {
      expect(installedServerValidationScript).toContain(requiredScriptValue);
    }
    expect(installedServerValidationScript.indexOf('verifyVsixIntegrity({')).toBeLessThan(
      installedServerValidationScript.indexOf("'--install-extension'"),
    );
    expect(installedServerValidationScript).not.toContain('--extensionDevelopmentPath');
    expect(installedServerValidationScript).not.toContain('@vscode/test-electron');
    expect(installedServerValidationScript).not.toContain('@vscode/test-cli');

    for (const requiredDriverValue of [
      "assertEqual(vscode.version, '1.132.0'",
      "assertEqual(process.platform, 'linux'",
      "assertEqual(process.arch, 'x64'",
      "assertEqual(process.versions.modules, '137'",
      'process.versions.electron === undefined',
      'vscode.env.remoteName',
      "const NATIVE_BINDING = 'native/linux-x64/node-abi137/better_sqlite3.node'",
      'assertPathOutside(installedExtensionPath, repositoryWorkspace',
      "JSON.stringify(['workspace'])",
      'await projectExtension.activate()',
      "await vscode.commands.executeCommand('project-dna.analyzeRepository')",
      "'project-dna.sqlite'",
      "const SQLITE_HEADER_HEX = '53514c69746520666f726d6174203300'",
      'rowsAfter > rowsBefore',
      'nativeBinding: bindingPath',
    ]) {
      expect(installedDriverSource).toContain(requiredDriverValue);
    }
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

function readFileIfPresent(relativePath: string): boolean {
  try {
    readFileSync(path.resolve(extensionRoot, relativePath));
    return true;
  } catch {
    return false;
  }
}
