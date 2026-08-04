import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PipelineStage,
  type IProjectDNAService,
  type PipelineProgress,
} from '@project-dna/dna-core';
import { Container, Err, ExtensionMessageSchema } from '@project-dna/shared';

const vscodeState = vi.hoisted(() => ({
  registeredCommand: null as (() => Promise<void>) | null,
}));

vi.mock('vscode', () => ({
  ProgressLocation: { Notification: 1 },
  Uri: {
    joinPath: () => ({ toString: () => 'vscode-resource' }),
  },
  commands: {
    registerCommand: (_id: string, command: () => Promise<void>) => {
      vscodeState.registeredCommand = command;
      return { dispose() {} };
    },
  },
  workspace: {
    workspaceFolders: [{ uri: { fsPath: 'C:/repo' } }],
  },
  window: {
    withProgress: async (
      _options: unknown,
      task: (
        progress: { report(value: { message?: string }): void },
        cancellation: {
          onCancellationRequested(listener: () => void): { dispose(): void };
        },
      ) => Promise<unknown>,
    ) => task({ report() {} }, { onCancellationRequested: () => ({ dispose() {} }) }),
    showWarningMessage: async () => undefined,
    showErrorMessage: async () => undefined,
    showInformationMessage: async () => undefined,
  },
}));

import { registerAnalyzeRepositoryCommand } from '../commands/analyze-repository.js';
import { SidebarProvider } from '../sidebar/sidebar-provider.js';

describe('command-triggered analysis publication', () => {
  beforeEach(() => {
    vscodeState.registeredCommand = null;
  });

  it('emits analysisStarted before progress for analysis initiated by a VS Code command', async () => {
    const progressListeners = new Set<(progress: PipelineProgress) => void>();
    const service = {
      onProgress(listener: (progress: PipelineProgress) => void) {
        progressListeners.add(listener);
        return () => progressListeners.delete(listener);
      },
      onReady() {
        return () => undefined;
      },
      async analyze() {
        for (const listener of progressListeners) {
          listener({
            stage: PipelineStage.Scanning,
            message: 'Scanning repository...',
            percent: 0,
            startedAt: 1,
          });
        }
        for (const listener of progressListeners) {
          listener({
            stage: PipelineStage.Failed,
            message: 'intentional test stop',
            percent: 0,
            startedAt: 2,
          });
        }
        return Err(new Error('intentional test stop'));
      },
    } as unknown as IProjectDNAService;
    const posted: unknown[] = [];
    const provider = new SidebarProvider(
      { toString: () => 'extension-uri' } as never,
      service,
      () => 'C:/repo',
    );
    provider.resolveWebviewView(
      {
        onDidDispose: () => ({ dispose() {} }),
        webview: {
          options: {},
          html: '',
          cspSource: 'vscode-webview:',
          asWebviewUri: () => ({ toString: () => 'vscode-resource' }),
          onDidReceiveMessage: () => ({ dispose() {} }),
          postMessage: async (message: unknown) => {
            posted.push(message);
            return true;
          },
        },
      } as never,
      {} as never,
      {} as never,
    );

    const container = { resolve: () => service } as unknown as Container;
    const context = { subscriptions: { push() {} } };
    registerAnalyzeRepositoryCommand(context as never, container);
    expect(vscodeState.registeredCommand).not.toBeNull();

    await vscodeState.registeredCommand?.();

    expect(posted.map((message) => ExtensionMessageSchema.parse(message).type)).toEqual([
      'analysisStarted',
      'analysisProgress',
      'analysisError',
    ]);
    provider.dispose();
  });

  it('keeps a webview opened mid-analysis in the analyzing state', async () => {
    const progressListeners = new Set<(progress: PipelineProgress) => void>();
    const service = {
      onProgress(listener: (progress: PipelineProgress) => void) {
        progressListeners.add(listener);
        return () => progressListeners.delete(listener);
      },
      onReady() {
        return () => undefined;
      },
      getCurrent() {
        throw new Error('Current data must not be published during analysis');
      },
    } as unknown as IProjectDNAService;
    const posted: unknown[] = [];
    let receiveMessage: ((message: unknown) => void) | undefined;
    const provider = new SidebarProvider(
      { toString: () => 'extension-uri' } as never,
      service,
      () => 'C:/repo',
    );
    provider.resolveWebviewView(
      {
        onDidDispose: () => ({ dispose() {} }),
        webview: {
          options: {},
          html: '',
          cspSource: 'vscode-webview:',
          asWebviewUri: () => ({ toString: () => 'vscode-resource' }),
          onDidReceiveMessage: (listener: (message: unknown) => void) => {
            receiveMessage = listener;
            return { dispose() {} };
          },
          postMessage: async (message: unknown) => {
            posted.push(message);
            return true;
          },
        },
      } as never,
      {} as never,
      {} as never,
    );

    for (const listener of progressListeners) {
      listener({
        stage: PipelineStage.Scanning,
        message: 'Scanning repository...',
        percent: 0,
        startedAt: 1,
      });
    }
    receiveMessage?.({ type: 'ready' });
    await Promise.resolve();

    expect(posted.map((message) => ExtensionMessageSchema.parse(message).type)).toEqual([
      'analysisStarted',
      'analysisProgress',
      'analysisStarted',
    ]);
    provider.dispose();
  });
});
