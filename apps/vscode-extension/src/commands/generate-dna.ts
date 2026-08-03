import * as vscode from 'vscode';
import { Container, TOKENS, isErr } from '@project-dna/shared';
import type { IProjectDNAService } from '@project-dna/dna-core';

export function registerGenerateDnaCommand(context: vscode.ExtensionContext, container: Container) {
  context.subscriptions.push(
    vscode.commands.registerCommand('project-dna.generateDna', async () => {
      const service = container.resolve<IProjectDNAService>(TOKENS.ProjectDNAService);
      const current = service.getCurrent();
      if (isErr(current) || !current.value) {
        await vscode.commands.executeCommand('project-dna.analyzeRepository');
        return;
      }
      await vscode.window.showInformationMessage(
        `Project DNA v${current.value.version}: ${current.value.profile.description}, health ${current.value.health.overallScore}/100.`,
      );
    }),
  );
}
