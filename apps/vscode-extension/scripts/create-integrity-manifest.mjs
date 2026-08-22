import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function collectFiles(root, current = root) {
  const entries = [];
  for (const name of readdirSync(current).sort((a, b) => a.localeCompare(b))) {
    const full = path.join(current, name);
    if (statSync(full).isDirectory()) entries.push(...collectFiles(root, full));
    else entries.push(path.relative(root, full).replaceAll('\\', '/'));
  }
  return entries.sort((a, b) => a.localeCompare(b));
}

export function createIntegrityManifest({ stagingRoot, metadata, outputPath, packagePath }) {
  const files = collectFiles(stagingRoot).map((relativePath) => {
    const bytes = readFileSync(path.join(stagingRoot, ...relativePath.split('/')));
    return {
      path: relativePath,
      size: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  });
  const manifest = {
    ...metadata,
    files,
    ...(packagePath
      ? { packageSha256: createHash('sha256').update(readFileSync(packagePath)).digest('hex') }
      : {}),
  };
  writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
}

if (isMain(import.meta.url)) {
  const stagingRoot = process.env.STAGING_DIR ?? path.resolve('release', 'staging');
  const outputPath = process.env.INTEGRITY_PATH ?? path.resolve('release', 'integrity.json');
  const extensionManifest = JSON.parse(
    readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'),
      'utf8',
    ),
  );
  createIntegrityManifest({
    stagingRoot,
    outputPath,
    metadata: {
      extensionId: 'project-dna.vscode-extension',
      version: extensionManifest.version,
      target: process.env.NATIVE_TARGET ?? `${process.platform}-${process.arch}`,
      platform: process.platform,
      architecture: process.arch,
      runtime: process.env.NATIVE_RUNTIME ?? 'electron',
      abi: process.env.NATIVE_ABI ?? '146',
      toolchain: 'Node 22.23.2 / pnpm 9.15.4',
      buildCommit: process.env.BUILD_COMMIT ?? 'unknown',
    },
    packagePath: process.env.VSIX_PATH ?? path.resolve('release', 'project-dna-a.vsix'),
  });
}

function isMain(moduleUrl) {
  return (
    process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(moduleUrl)
  );
}
