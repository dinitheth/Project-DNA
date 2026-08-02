import * as vscode from 'vscode';
import { Container } from '@project-dna/shared';

export function registerOpenArchitectureCommand(context: vscode.ExtensionContext, _container: Container) {
  context.subscriptions.push(
    vscode.commands.registerCommand('project-dna.openArchitecture', async () => {
      vscode.window.showInformationMessage('Project DNA: Opening Architecture...');
    })
  );
}
