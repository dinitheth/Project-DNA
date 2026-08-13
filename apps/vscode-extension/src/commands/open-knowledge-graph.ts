import * as vscode from 'vscode';
import { COMMAND_IDS, VIEW_IDS } from '@project-dna/shared';
import type { SidebarProvider } from '../sidebar/sidebar-provider.js';

export function registerOpenKnowledgeGraphCommand(
  context: vscode.ExtensionContext,
  sidebarProvider: SidebarProvider,
) {
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_IDS.openKnowledgeGraph, async () => {
      await vscode.commands.executeCommand(`${VIEW_IDS.sidebar}.focus`);
      sidebarProvider.navigateTo('knowledge');
    }),
  );
}
