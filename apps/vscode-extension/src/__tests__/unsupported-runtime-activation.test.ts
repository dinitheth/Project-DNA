import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  createContainer: vi.fn(),
  registerAllCommands: vi.fn(),
  watcher: vi.fn(),
  errorMessages: [] as string[],
  commands: [] as string[],
  providers: [] as string[],
}));

vi.mock('../runtime/native-runtime.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../runtime/native-runtime.js')>();
  return {
    ...original,
    resolveNativeBinding: () => {
      throw new original.UnsupportedNativeRuntimeError(
        { platform: 'linux', arch: 'arm64', modules: '137' },
        'controlled unsupported runtime',
      );
    },
  };
});
vi.mock('../container.js', () => ({ createContainer: state.createContainer }));
vi.mock('../commands/index.js', () => ({ registerAllCommands: state.registerAllCommands }));
vi.mock('../repository-watcher.js', () => ({ RepositoryWatcher: state.watcher }));
vi.mock('../sidebar/sidebar-provider.js', () => ({ SidebarProvider: vi.fn() }));
vi.mock('vscode', () => ({
  commands: {
    registerCommand: (id: string) => {
      state.commands.push(id);
      return { dispose() {} };
    },
  },
  window: {
    showErrorMessage: async (message: string) => {
      state.errorMessages.push(message);
    },
    registerWebviewViewProvider: (id: string) => {
      state.providers.push(id);
      return { dispose() {} };
    },
  },
}));

import { activate } from '../extension.js';

describe('unsupported runtime activation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.errorMessages.length = 0;
    state.commands.length = 0;
    state.providers.length = 0;
  });

  it('fails before container, storage, recovery, watcher, worker, or snapshot construction', async () => {
    const subscriptions: unknown[] = [];
    await activate({
      extensionUri: { fsPath: 'C:/controlled-extension' },
      extension: { packageJSON: { version: '1.0.0' } },
      subscriptions: { push: (...items: unknown[]) => subscriptions.push(...items) },
    } as never);

    expect(state.createContainer).not.toHaveBeenCalled();
    expect(state.registerAllCommands).not.toHaveBeenCalled();
    expect(state.watcher).not.toHaveBeenCalled();
    expect(state.errorMessages).toHaveLength(1);
    expect(state.errorMessages[0]).toContain('database was not modified');
    expect(state.commands).toHaveLength(5);
    expect(state.providers).toEqual(['project-dna.sidebar.webview']);
    expect(subscriptions).toHaveLength(6);
  });
});
