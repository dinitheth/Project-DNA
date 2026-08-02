import * as vscode from 'vscode';
import { createContainer } from './container';
import { registerAllCommands } from './commands';
import { SidebarProvider } from './sidebar/sidebar-provider';

export function activate(context: vscode.ExtensionContext) {
  const container = createContainer();
  
  registerAllCommands(context, container);
  
  const sidebarProvider = new SidebarProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      'project-dna.sidebar.webview',
      sidebarProvider
    )
  );
}

export function deactivate() {}
