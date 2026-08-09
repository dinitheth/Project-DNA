import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ELECTRON_VERSION = '42.7.1';
const ELECTRON_ABI = '146';
const NODE_VERSION = 'v24.19.0';
const NODE_ABI = '137';
const localRequire = createRequire(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../package.json'),
);

export function assertNodeBuilder(version, modules) {
  if (version !== NODE_VERSION || modules !== NODE_ABI) {
    throw new Error(
      `Node native builder mismatch: expected ${NODE_VERSION} ABI ${NODE_ABI}, got ${version} ABI ${modules}`,
    );
  }
}

export function nativeArtifactPath(root, target, runtime) {
  const suffix = runtime === 'node' ? `node-abi${NODE_ABI}` : `electron-abi${ELECTRON_ABI}`;
  return path.join(root, 'native', target, suffix, 'better_sqlite3.node');
}

export function validateTarget(target, runtime) {
  const validTargets = new Set(['win32-x64', 'linux-x64', 'darwin-x64', 'darwin-arm64']);
  if (!validTargets.has(target)) throw new Error(`Unsupported native target: ${target}`);
  if (runtime === 'node' && target !== 'linux-x64') {
    throw new Error('Node ABI 137 is supported only for linux-x64');
  }
  if (runtime !== 'electron' && runtime !== 'node')
    throw new Error(`Unsupported runtime: ${runtime}`);
}

export function buildNative({
  target,
  runtime,
  root = path.resolve('..', '..'),
  runner = execFileSync,
}) {
  validateTarget(target, runtime);
  if (runtime === 'node') assertNodeBuilder(process.version, process.versions.modules);
  const moduleDir = path.join(root, '.native-build', `${target}-${runtime}`);
  const output = nativeArtifactPath(root, target, runtime);
  rmSync(moduleDir, { recursive: true, force: true });
  mkdirSync(path.dirname(output), { recursive: true });
  const sourcePackage = path.join(
    root,
    'apps',
    'vscode-extension',
    'node_modules',
    'better-sqlite3',
  );
  const isolatedPackage = path.join(moduleDir, 'node_modules', 'better-sqlite3');
  cpSync(sourcePackage, isolatedPackage, { recursive: true });
  rmSync(path.join(isolatedPackage, 'build'), { recursive: true, force: true });
  writeFileSync(
    path.join(moduleDir, 'package.json'),
    `${JSON.stringify({ private: true, dependencies: { 'better-sqlite3': '12.11.1' } }, null, 2)}\n`,
    'utf8',
  );

  if (runtime === 'electron') {
    const electronRebuildCli = path.join(
      path.dirname(localRequire.resolve('@electron/rebuild')),
      'cli.js',
    );
    runner(
      process.execPath,
      [
        electronRebuildCli,
        'electron-rebuild',
        '--version',
        ELECTRON_VERSION,
        '--only',
        'better-sqlite3',
        '--build-from-source',
        '--force',
        '--sequential',
        '--arch',
        target.split('-')[1],
        '--module-dir',
        moduleDir,
      ],
      { cwd: root, stdio: 'inherit' },
    );
  } else {
    const rebuildRequire = createRequire(localRequire.resolve('@electron/rebuild'));
    const nodeGypCli = rebuildRequire.resolve('node-gyp/bin/node-gyp.js');
    runner(
      process.execPath,
      [nodeGypCli, 'rebuild', '--build-from-source', '--target=24.19.0', '--arch=x64'],
      { cwd: isolatedPackage, stdio: 'inherit' },
    );
  }

  const built = path.join(isolatedPackage, 'build', 'Release', 'better_sqlite3.node');
  if (!existsSync(built)) throw new Error(`Native build did not produce ${built}`);
  validateBuiltBinding({ target, runtime, bindingPath: built, runner });
  cpSync(built, output);
  return output;
}

export function validateBuiltBinding({ target, runtime, bindingPath, runner = execFileSync }) {
  const databaseModule = path.resolve(path.dirname(bindingPath), '../../lib/index.js');
  const verifier = [
    `const Database=require(${JSON.stringify(databaseModule)});`,
    `const db=new Database(':memory:',{nativeBinding:${JSON.stringify(bindingPath)}});`,
    "const result=db.pragma('quick_check',{simple:true});",
    'db.close();',
    "if(result!=='ok')throw new Error('SQLite quick_check failed: '+result);",
  ].join('');
  if (runtime === 'node') {
    assertNodeBuilder(process.version, process.versions.modules);
    runner(process.execPath, ['-e', verifier], { stdio: 'inherit' });
    return;
  }
  const electronExecutable = process.env.ELECTRON_EXECUTABLE;
  if (!electronExecutable) {
    throw new Error(
      `ELECTRON_EXECUTABLE for Electron ${ELECTRON_VERSION} ABI ${ELECTRON_ABI} is required to validate ${target}`,
    );
  }
  runner(
    electronExecutable,
    [
      '-e',
      `if(process.versions.electron!==${JSON.stringify(ELECTRON_VERSION)}||process.versions.modules!==${JSON.stringify(ELECTRON_ABI)})throw new Error('Electron verifier runtime mismatch');${verifier}`,
    ],
    {
      stdio: 'inherit',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    },
  );
}

if (isMain(import.meta.url)) {
  const target = process.env.NATIVE_TARGET ?? `${process.platform}-${process.arch}`;
  const runtime = process.env.NATIVE_RUNTIME ?? 'electron';
  buildNative({ target, runtime });
}

function isMain(moduleUrl) {
  return (
    process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(moduleUrl)
  );
}
