import * as vscode from 'vscode';
import { TOKENS, isErr } from '@project-dna/shared';
import type { IProjectDNAService } from '@project-dna/dna-core';
import { createContainer } from './container';
import { registerAllCommands } from './commands';
import { SidebarProvider } from './sidebar/sidebar-provider';

let activeContainer: ReturnType<typeof createContainer> | null = null;

export async function activate(context: vscode.ExtensionContext) {
  const container = createContainer({
    storagePath: vscode.Uri.joinPath(context.globalStorageUri, 'project-dna.sqlite').fsPath,
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

  registerAllCommands(context, container);

  const sidebarProvider = new SidebarProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('project-dna.sidebar.webview', sidebarProvider),
  );
}

export async function deactivate() {
  if (!activeContainer) return;
  if (activeContainer.has(TOKENS.ProjectDNAService)) {
    await activeContainer.resolve<IProjectDNAService>(TOKENS.ProjectDNAService).dispose();
  }
  activeContainer.reset();
  activeContainer = null;
}
