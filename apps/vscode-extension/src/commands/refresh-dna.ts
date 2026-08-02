import * as vscode from 'vscode';
import { Container } from '@project-dna/shared';

export function registerRefreshDnaCommand(context: vscode.ExtensionContext, _container: Container) {
  context.subscriptions.push(
    vscode.commands.registerCommand('project-dna.refreshDna', async () => {
      vscode.window.showInformationMessage('Project DNA: Refreshing DNA...');
    })
  );
}
