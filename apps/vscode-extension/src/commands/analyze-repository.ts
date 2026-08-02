import * as vscode from 'vscode';
import { Container } from '@project-dna/shared';

export function registerAnalyzeRepositoryCommand(context: vscode.ExtensionContext, _container: Container) {
  context.subscriptions.push(
    vscode.commands.registerCommand('project-dna.analyzeRepository', async () => {
      vscode.window.showInformationMessage('Project DNA: Analyzing Repository...');
    })
  );
}
