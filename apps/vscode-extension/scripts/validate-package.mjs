import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createIntegrityManifest } from './create-integrity-manifest.mjs';
import { stageExtension } from './stage-extension.mjs';

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function validateStaging({ stagingRoot, contract, target, runtime }) {
  const actual = collectFiles(stagingRoot);
  const expected = new Set([
    ...contract.vsix.allowedApplicationFiles,
    ...contract.vsix.allowedTreeSitterFiles,
    ...contract.vsix.allowedSqliteFiles,
    ...(contract.vsix.nativeBindings[target] ?? []),
  ]);
  const unexpected = actual.filter((relativePath) => !expected.has(relativePath));
  const missing = [...expected].filter((relativePath) => !actual.includes(relativePath));
  if (unexpected.length || missing.length) {
    throw new Error(
      `Invalid staging: missing=${missing.join(',')} unexpected=${unexpected.join(',')}`,
    );
  }
  return { files: actual, sha256: hashDirectory(stagingRoot, actual) };
}

export function comparePackages(firstPath, secondPath) {
  const first = readFileSync(firstPath);
  const second = readFileSync(secondPath);
  if (!first.equals(second)) {
    throw new Error(`VSIX packaging is not deterministic: ${firstPath} differs from ${secondPath}`);
  }
}

export function packageDeterministically({
  extensionRoot: root = extensionRoot,
  contract,
  target,
  runtime,
  sourceDateEpoch = process.env.SOURCE_DATE_EPOCH ?? contract.runtime.packaging.sourceDateEpoch,
  runner = execFileSync,
}) {
  const releaseRoot = path.join(root, 'release');
  const stagingA = path.join(releaseRoot, 'staging-a');
  const stagingB = path.join(releaseRoot, 'staging-b');
  const vsixA = path.join(releaseRoot, 'project-dna-a.vsix');
  const vsixB = path.join(releaseRoot, 'project-dna-b.vsix');
  const nativeFiles = contract.vsix.nativeBindings[target] ?? [];
  for (const stagingRoot of [stagingA, stagingB]) {
    stageExtension({ stagingRoot, target, nativeFiles, contract });
    validateStaging({ stagingRoot, contract, target, runtime });
  }
  const env = { ...process.env, SOURCE_DATE_EPOCH: sourceDateEpoch };
  runner('pnpm', ['exec', 'vsce', 'package', '--no-dependencies', '--out', vsixA], {
    cwd: stagingA,
    env,
    stdio: 'inherit',
  });
  runner('pnpm', ['exec', 'vsce', 'package', '--no-dependencies', '--out', vsixB], {
    cwd: stagingB,
    env,
    stdio: 'inherit',
  });
  comparePackages(vsixA, vsixB);
  const integrityPath = path.join(releaseRoot, 'integrity.json');
  const integrity = createIntegrityManifest({
    stagingRoot: stagingA,
    outputPath: integrityPath,
    packagePath: vsixA,
    metadata: {
      extensionId: 'project-dna.vscode-extension',
      version: '1.0.0',
      target,
      platform: target.split('-')[0],
      architecture: target.split('-')[1],
      runtime,
      abi: runtime === 'node' ? '137' : '146',
      toolchain: 'Node 22.23.2 / pnpm 9.15.4',
      buildCommit: process.env.BUILD_COMMIT ?? 'unknown',
    },
  });
  return { vsixPath: vsixA, integrityPath, integrity };
}

function collectFiles(root, current = root) {
  const files = [];
  for (const name of readdirSync(current).sort((a, b) => a.localeCompare(b))) {
    const full = path.join(current, name);
    if (statSync(full).isDirectory()) files.push(...collectFiles(root, full));
    else files.push(path.relative(root, full).replaceAll('\\', '/'));
  }
  return files.sort((a, b) => a.localeCompare(b));
}

function hashDirectory(root, files) {
  const hash = createHash('sha256');
  for (const relativePath of files)
    hash
      .update(relativePath)
      .update('\0')
      .update(readFileSync(path.join(root, ...relativePath.split('/'))));
  return hash.digest('hex');
}

if (isMain(import.meta.url)) {
  if (process.argv[2] === '--package') {
    const contract = JSON.parse(
      readFileSync(path.join(extensionRoot, 'release-contract.json'), 'utf8'),
    );
    packageDeterministically({
      contract,
      target: process.env.NATIVE_TARGET ?? `${process.platform}-${process.arch}`,
      runtime: process.env.NATIVE_RUNTIME ?? 'electron',
    });
    process.exit(0);
  }
  if (process.argv[2] === '--compare') {
    comparePackages(process.argv[3], process.argv[4]);
    process.exit(0);
  }
  const root = path.resolve(process.env.STAGING_DIR ?? path.join('release', 'staging'));
  const contract = JSON.parse(
    readFileSync(path.join(extensionRoot, 'release-contract.json'), 'utf8'),
  );
  validateStaging({
    stagingRoot: root,
    contract,
    target: process.env.NATIVE_TARGET ?? `${process.platform}-${process.arch}`,
    runtime: process.env.NATIVE_RUNTIME ?? 'electron',
  });
}

function isMain(moduleUrl) {
  return (
    process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(moduleUrl)
  );
}
