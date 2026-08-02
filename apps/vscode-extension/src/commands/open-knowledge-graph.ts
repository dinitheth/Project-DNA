import * as vscode from 'vscode';
import { Container } from '@project-dna/shared';

export function registerOpenKnowledgeGraphCommand(context: vscode.ExtensionContext, _container: Container) {
  context.subscriptions.push(
    vscode.commands.registerCommand('project-dna.openKnowledgeGraph', async () => {
      vscode.window.showInformationMessage('Project DNA: Opening Knowledge Graph...');
    })
  );
}
