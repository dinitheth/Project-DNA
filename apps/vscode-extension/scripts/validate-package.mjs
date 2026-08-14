import { createHash } from 'node:crypto';
import { createWriteStream, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createIntegrityManifest } from './create-integrity-manifest.mjs';
import { stageExtension } from './stage-extension.mjs';

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const vsce = require('@vscode/vsce/out/package.js');
const vsceRequire = createRequire(require.resolve('@vscode/vsce/package.json'));
const { ZipFile } = vsceRequire('yazl');

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

export async function createVsixFromStaging({
  stagingRoot,
  stagedFiles,
  outputPath,
  target,
  sourceDateEpoch,
}) {
  const manifest = vsce.validateManifestForPackaging(
    JSON.parse(readFileSync(path.join(stagingRoot, 'package.json'), 'utf8')),
  );
  const options = {
    cwd: stagingRoot,
    dependencies: false,
    packagePath: outputPath,
    target,
  };
  const inputFiles = stagedFiles.map((relativePath) => ({
    path: `extension/${relativePath}`,
    localPath: path.join(stagingRoot, ...relativePath.split('/')),
  }));
  const files = await vsce.processFiles(
    vsce.createDefaultProcessors(manifest, options),
    inputFiles,
  );
  await vsce.printAndValidatePackagedFiles(files, stagingRoot, manifest, options);
  await writeDeterministicVsix(files, outputPath, sourceDateEpoch);
  return files.map((file) => file.path).sort((a, b) => a.localeCompare(b));
}

export async function packageDeterministically({
  extensionRoot: root = extensionRoot,
  contract,
  target,
  runtime,
  sourceDateEpoch = process.env.SOURCE_DATE_EPOCH ?? contract.runtime.packaging.sourceDateEpoch,
}) {
  const releaseRoot = path.join(root, 'release');
  const stagingA = path.join(releaseRoot, 'staging-a');
  const stagingB = path.join(releaseRoot, 'staging-b');
  const vsixA = path.join(releaseRoot, 'project-dna-a.vsix');
  const vsixB = path.join(releaseRoot, 'project-dna-b.vsix');
  const nativeFiles = contract.vsix.nativeBindings[target] ?? [];
  stageExtension({ stagingRoot: stagingA, target, nativeFiles, contract });
  stageExtension({ stagingRoot: stagingB, target, nativeFiles, contract });
  const validatedA = validateStaging({ stagingRoot: stagingA, contract, target, runtime });
  const validatedB = validateStaging({ stagingRoot: stagingB, contract, target, runtime });
  await createVsixFromStaging({
    stagingRoot: stagingA,
    stagedFiles: validatedA.files,
    outputPath: vsixA,
    target,
    sourceDateEpoch,
  });
  await createVsixFromStaging({
    stagingRoot: stagingB,
    stagedFiles: validatedB.files,
    outputPath: vsixB,
    target,
    sourceDateEpoch,
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

async function writeDeterministicVsix(files, outputPath, sourceDateEpoch) {
  mkdirSync(path.dirname(outputPath), { recursive: true });
  const zip = new ZipFile();
  const archiveOptions = { mtime: new Date(Number(sourceDateEpoch) * 1000) };
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    const options = { ...archiveOptions, ...(file.mode === undefined ? {} : { mode: file.mode }) };
    if ('contents' in file) {
      zip.addBuffer(
        typeof file.contents === 'string' ? Buffer.from(file.contents, 'utf8') : file.contents,
        file.path,
        options,
      );
    } else {
      zip.addFile(file.localPath, file.path, options);
    }
  }
  await new Promise((resolve, reject) => {
    const output = createWriteStream(outputPath);
    zip.outputStream.once('error', reject);
    output.once('error', reject);
    output.once('finish', resolve);
    zip.outputStream.pipe(output);
    zip.end();
  });
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
  runMain().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

async function runMain() {
  if (process.argv[2] === '--package') {
    const contract = JSON.parse(
      readFileSync(path.join(extensionRoot, 'release-contract.json'), 'utf8'),
    );
    await packageDeterministically({
      contract,
      target: process.env.NATIVE_TARGET ?? `${process.platform}-${process.arch}`,
      runtime: process.env.NATIVE_RUNTIME ?? 'electron',
    });
    return;
  }
  if (process.argv[2] === '--compare') {
    comparePackages(process.argv[3], process.argv[4]);
    return;
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
