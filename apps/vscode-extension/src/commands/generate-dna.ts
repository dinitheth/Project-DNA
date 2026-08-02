import * as vscode from 'vscode';
import { Container } from '@project-dna/shared';

export function registerGenerateDnaCommand(context: vscode.ExtensionContext, _container: Container) {
  context.subscriptions.push(
    vscode.commands.registerCommand('project-dna.generateDna', async () => {
      vscode.window.showInformationMessage('Project DNA: Generating DNA...');
    })
  );
}
