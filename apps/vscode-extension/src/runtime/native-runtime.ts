import { accessSync, constants, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

export interface NativeRuntimeTuple {
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  readonly modules: string;
  readonly electron?: string;
}

export interface NativeRuntimeSelection {
  readonly target: 'win32-x64' | 'linux-x64' | 'darwin-x64' | 'darwin-arm64';
  readonly runtime: 'electron' | 'node';
  readonly abi: '146' | '137';
  readonly relativeBindingPath: string;
}

export interface NativeBindingSelection extends NativeRuntimeSelection {
  readonly nativeBindingPath: string;
}

export class UnsupportedNativeRuntimeError extends Error {
  constructor(
    public readonly tuple: NativeRuntimeTuple,
    message: string,
  ) {
    super(message);
    this.name = 'UnsupportedNativeRuntimeError';
  }
}

const ELECTRON_ABI = '146';
const NODE_ABI = '137';
const SUPPORTED_ELECTRON_VERSIONS = new Set(['42.7.1', '42.8.0']);

const ELECTRON_TARGETS = new Map<string, NativeRuntimeSelection['target']>([
  ['win32-x64', 'win32-x64'],
  ['linux-x64', 'linux-x64'],
  ['darwin-x64', 'darwin-x64'],
  ['darwin-arm64', 'darwin-arm64'],
]);

export function readCurrentRuntimeTuple(): NativeRuntimeTuple {
  return {
    platform: process.platform,
    arch: process.arch,
    modules: process.versions.modules,
    ...(process.versions.electron ? { electron: process.versions.electron } : {}),
  };
}

/** Pure deterministic mapping from a runtime tuple to one packaged native artifact. */
export function resolveNativeRuntime(tuple: NativeRuntimeTuple): NativeRuntimeSelection {
  const platformTarget = `${tuple.platform}-${tuple.arch}`;
  if (tuple.electron !== undefined) {
    const target = ELECTRON_TARGETS.get(platformTarget);
    if (
      SUPPORTED_ELECTRON_VERSIONS.has(tuple.electron) &&
      tuple.modules === ELECTRON_ABI &&
      target
    ) {
      return {
        target,
        runtime: 'electron',
        abi: ELECTRON_ABI,
        relativeBindingPath: `native/${target}/electron-abi${ELECTRON_ABI}/better_sqlite3.node`,
      };
    }
    throw unsupported(tuple, `Electron ${tuple.electron} ABI ${tuple.modules}`);
  }

  if (tuple.platform === 'linux' && tuple.arch === 'x64' && tuple.modules === NODE_ABI) {
    return {
      target: 'linux-x64',
      runtime: 'node',
      abi: NODE_ABI,
      relativeBindingPath: `native/linux-x64/node-abi${NODE_ABI}/better_sqlite3.node`,
    };
  }

  throw unsupported(tuple, `Node ABI ${tuple.modules}`);
}

export function resolveNativeBinding(
  extensionRoot: string,
  tuple: NativeRuntimeTuple = readCurrentRuntimeTuple(),
  verifyFile: (filePath: string) => void = validateNativeBindingFile,
): NativeBindingSelection {
  const selection = resolveNativeRuntime(tuple);
  const nativeBindingPath = path.resolve(
    extensionRoot,
    ...selection.relativeBindingPath.split('/'),
  );
  try {
    verifyFile(nativeBindingPath);
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    throw new UnsupportedNativeRuntimeError(
      tuple,
      `${formatRuntime(tuple)} is supported, but its Project DNA native binding is unavailable: ${cause}`,
    );
  }
  return { ...selection, nativeBindingPath };
}

export function formatCompatibilityError(
  error: UnsupportedNativeRuntimeError,
  extensionVersion: string,
): string {
  return `Project DNA cannot start on ${error.tuple.platform}-${error.tuple.arch}: ${formatRuntime(error.tuple)} is not supported by Project DNA ${extensionVersion}. Supported runtimes are Electron 42.7.1 or 42.8.0 ABI ${ELECTRON_ABI} on win32-x64, linux-x64, darwin-x64, or darwin-arm64, and Linux x64 Node ABI ${NODE_ABI}. Your existing Project DNA database was not modified. ${error.message}`;
}

function assertReadableFile(filePath: string): void {
  if (!statSync(filePath).isFile()) throw new Error(`${filePath} is not a file`);
  accessSync(filePath, constants.R_OK);
}

export function validateNativeBindingFile(filePath: string): void {
  assertReadableFile(filePath);
  const requireNative = createRequire(path.resolve(filePath, '..', 'project-dna-loader.cjs'));
  const loaded = requireNative(filePath) as { readonly Database?: unknown };
  if (typeof loaded?.Database !== 'function') {
    throw new Error(`${filePath} is not a compatible better-sqlite3 native binding`);
  }
}

function unsupported(tuple: NativeRuntimeTuple, runtime: string): UnsupportedNativeRuntimeError {
  return new UnsupportedNativeRuntimeError(
    tuple,
    `Unsupported Project DNA native runtime: ${tuple.platform}-${tuple.arch} ${runtime}`,
  );
}

function formatRuntime(tuple: NativeRuntimeTuple): string {
  return tuple.electron
    ? `Electron ${tuple.electron} module ABI ${tuple.modules}`
    : `Node module ABI ${tuple.modules}`;
}
