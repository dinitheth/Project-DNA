import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  UnsupportedNativeRuntimeError,
  resolveNativeBinding,
  resolveNativeRuntime,
  type NativeRuntimeTuple,
} from '../runtime/native-runtime.js';

describe('native runtime resolution', () => {
  it.each([
    ['win32', 'x64', 'win32-x64'],
    ['linux', 'x64', 'linux-x64'],
    ['darwin', 'x64', 'darwin-x64'],
    ['darwin', 'arm64', 'darwin-arm64'],
  ] as const)('selects the Electron ABI 146 binding for %s-%s', (platform, arch, target) => {
    expect(resolveNativeRuntime({ platform, arch, modules: '146', electron: '42.7.1' })).toEqual({
      target,
      runtime: 'electron',
      abi: '146',
      relativeBindingPath: `native/${target}/electron-abi146/better_sqlite3.node`,
    });
  });

  it('selects only the Linux x64 Node ABI 137 binding for remote extension hosts', () => {
    expect(resolveNativeRuntime(nodeTuple())).toEqual({
      target: 'linux-x64',
      runtime: 'node',
      abi: '137',
      relativeBindingPath: 'native/linux-x64/node-abi137/better_sqlite3.node',
    });
  });

  it.each([
    tuple({ modules: '145', electron: '42.7.1' }),
    tuple({ platform: 'win32', modules: '137' }),
    tuple({ platform: 'linux', arch: 'arm64', modules: '137' }),
    tuple({ electron: '41.0.0', modules: '146' }),
  ])('rejects unsupported tuples without fallback or substitution', (runtimeTuple) => {
    expect(() => resolveNativeRuntime(runtimeTuple)).toThrow(UnsupportedNativeRuntimeError);
  });

  it('uses only a controlled explicit binding path', () => {
    const verifyFile = vi.fn();
    const selection = resolveNativeBinding('C:/extension', nodeTuple(), verifyFile);
    expect(selection.nativeBindingPath).toBe(
      path.resolve('C:/extension/native/linux-x64/node-abi137/better_sqlite3.node'),
    );
    expect(verifyFile).toHaveBeenCalledExactlyOnceWith(selection.nativeBindingPath);
  });

  it.each([new Error('missing'), new Error('unreadable'), new Error('invalid')])(
    'rejects missing, unreadable, or invalid controlled bindings',
    (failure) => {
      expect(() =>
        resolveNativeBinding('C:/extension', nodeTuple(), () => {
          throw failure;
        }),
      ).toThrow(UnsupportedNativeRuntimeError);
    },
  );

  it('does not inspect the developer machine when a controlled verifier is supplied', () => {
    const verifier = vi.fn();
    resolveNativeBinding('Z:/does-not-exist', nodeTuple(), verifier);
    expect(verifier).toHaveBeenCalledOnce();
  });
});

function tuple(overrides: Partial<NativeRuntimeTuple> = {}): NativeRuntimeTuple {
  return { platform: 'linux', arch: 'x64', modules: '146', electron: '42.7.1', ...overrides };
}

function nodeTuple(): NativeRuntimeTuple {
  return { platform: 'linux', arch: 'x64', modules: '137' };
}
