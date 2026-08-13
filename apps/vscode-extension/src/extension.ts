import * as vscode from 'vscode';
import {
  COMMAND_IDS,
  TOKENS,
  VIEW_IDS,
  isErr,
  type DNAEventMap,
  type EventBus,
} from '@project-dna/shared';
import type { IProjectDNAService } from '@project-dna/dna-core';
import { createContainer } from './container';
import { registerAllCommands } from './commands';
import { SidebarProvider } from './sidebar/sidebar-provider';
import { RepositoryWatcher } from './repository-watcher';
import {
  UnsupportedNativeRuntimeError,
  formatCompatibilityError,
  resolveNativeBinding,
} from './runtime/native-runtime';

let activeContainer: ReturnType<typeof createContainer> | null = null;

export async function activate(context: vscode.ExtensionContext) {
  let nativeBindingPath: string;
  try {
    nativeBindingPath = resolveNativeBinding(context.extensionUri.fsPath).nativeBindingPath;
  } catch (error) {
    if (!(error instanceof UnsupportedNativeRuntimeError)) throw error;
    const version = String(context.extension.packageJSON.version ?? 'unknown');
    const message = formatCompatibilityError(error, version);
    registerUnsupportedRuntime(context, message);
    void vscode.window.showErrorMessage(message);
    return;
  }

  const container = createContainer({
    storagePath: vscode.Uri.joinPath(context.globalStorageUri, 'project-dna.sqlite').fsPath,
    nativeBindingPath,
  });
  activeContainer = container;

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (workspaceRoot) {
    const restored = await container
      .resolve<IProjectDNAService>(TOKENS.ProjectDNAService)
      .restore(workspaceRoot);
    if (isErr(restored)) {
      void vscode.window.showWarningMessage(
        `Project DNA could not restore its previous analysis: ${restored.error.message}`,
      );
    }
  }

  const sidebarProvider = new SidebarProvider(
    context.extensionUri,
    container.resolve<IProjectDNAService>(TOKENS.ProjectDNAService),
    () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
  );
  context.subscriptions.push(
    sidebarProvider,
    vscode.window.registerWebviewViewProvider(VIEW_IDS.sidebar, sidebarProvider),
  );
  registerAllCommands(context, container, sidebarProvider);
  const repositoryWatcher = new RepositoryWatcher(
    container.resolve<EventBus<DNAEventMap>>(TOKENS.EventBus),
    (rootPath) => sidebarProvider.handleWorkspaceChanged(rootPath),
  );
  context.subscriptions.push(repositoryWatcher);
}

function registerUnsupportedRuntime(context: vscode.ExtensionContext, message: string): void {
  for (const commandId of Object.values(COMMAND_IDS)) {
    context.subscriptions.push(
      vscode.commands.registerCommand(commandId, () => vscode.window.showErrorMessage(message)),
    );
  }
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW_IDS.sidebar, {
      resolveWebviewView(view) {
        view.webview.options = { enableScripts: false };
        view.webview.html = `<!doctype html><html><body><p>${escapeHtml(message)}</p></body></html>`;
      },
    }),
  );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export async function deactivate() {
  if (!activeContainer) return;
  if (activeContainer.has(TOKENS.ProjectDNAService)) {
    await activeContainer.resolve<IProjectDNAService>(TOKENS.ProjectDNAService).dispose();
  }
  activeContainer.reset();
  activeContainer = null;
}
