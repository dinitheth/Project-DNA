import {
  chmodSync,
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(scriptRoot, '..');
const repositoryRoot = path.resolve(extensionRoot, '..', '..');

export const SQLITE_FILES = [
  'package.json',
  'lib/index.js',
  'lib/database.js',
  'lib/sqlite-error.js',
  'lib/util.js',
  'lib/methods/aggregate.js',
  'lib/methods/backup.js',
  'lib/methods/function.js',
  'lib/methods/inspect.js',
  'lib/methods/pragma.js',
  'lib/methods/serialize.js',
  'lib/methods/table.js',
  'lib/methods/transaction.js',
  'lib/methods/wrappers.js',
];

export function normalizeRelative(relativePath) {
  return relativePath.replaceAll('\\', '/').replace(/^\.\//u, '');
}

export function copyAllowlistedFile(sourceRoot, stagingRoot, relativePath) {
  const normalized = normalizeRelative(relativePath);
  const destination = path.join(stagingRoot, ...normalized.split('/'));
  mkdirSync(path.dirname(destination), { recursive: true });
  cpSync(path.join(sourceRoot, ...normalized.split('/')), destination);
}

export function copyApplicationFile(stagingRoot, relativePath) {
  if (relativePath === 'package.json') {
    writeStagedManifest(stagingRoot);
    return;
  }
  if (relativePath === 'LICENSE.txt') {
    const destination = path.join(stagingRoot, relativePath);
    mkdirSync(path.dirname(destination), { recursive: true });
    cpSync(path.join(repositoryRoot, 'LICENSE'), destination);
    return;
  }
  copyAllowlistedFile(extensionRoot, stagingRoot, relativePath);
}

export function stageExtension({ stagingRoot, target, nativeFiles, contract }) {
  rmSync(stagingRoot, { recursive: true, force: true });
  mkdirSync(stagingRoot, { recursive: true });
  for (const relativePath of contract.vsix.allowedApplicationFiles) {
    copyApplicationFile(stagingRoot, relativePath);
  }
  for (const relativePath of contract.vsix.allowedTreeSitterFiles) {
    copyAllowlistedFile(extensionRoot, stagingRoot, relativePath);
  }
  for (const relativePath of SQLITE_FILES) {
    copyAllowlistedFile(extensionRoot, stagingRoot, `node_modules/better-sqlite3/${relativePath}`);
  }
  for (const relativePath of nativeFiles)
    copyAllowlistedFile(repositoryRoot, stagingRoot, relativePath);
  normalizeStagingTree(stagingRoot);
  return stagingRoot;
}

export function normalizeStagingTree(root, epochSeconds = 0) {
  const entries = [root];
  while (entries.length) {
    const current = entries.pop();
    if (!current) continue;
    const stats = statSync(current);
    chmodSync(current, stats.isDirectory() ? 0o755 : 0o644);
    utimesSync(current, epochSeconds, epochSeconds);
    if (stats.isDirectory()) {
      for (const child of readdirSync(current)) entries.push(path.join(current, child));
    }
  }
}

function writeStagedManifest(stagingRoot) {
  const manifest = JSON.parse(readFileSync(path.join(extensionRoot, 'package.json'), 'utf8'));
  manifest.dependencies = Object.fromEntries(
    Object.entries(manifest.dependencies ?? {}).filter(([name]) =>
      ['better-sqlite3', 'web-tree-sitter', 'tree-sitter-wasms'].includes(name),
    ),
  );
  delete manifest.devDependencies;
  writeFileSync(
    path.join(stagingRoot, 'package.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
}

if (isMain(import.meta.url)) {
  const contract = JSON.parse(
    readFileSync(path.join(extensionRoot, 'release-contract.json'), 'utf8'),
  );
  const target = process.env.NATIVE_TARGET ?? `${process.platform}-${process.arch}`;
  const stagingRoot = process.env.STAGING_DIR ?? path.join(extensionRoot, 'release', 'staging');
  const nativeFiles = contract.vsix.nativeBindings[target] ?? [];
  stageExtension({ stagingRoot, target, nativeFiles, contract });
}

function isMain(moduleUrl) {
  return (
    process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(moduleUrl)
  );
}
