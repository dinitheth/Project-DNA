import * as vscode from 'vscode';
import { Container, TOKENS, isErr } from '@project-dna/shared';
import type { IProjectDNAService } from '@project-dna/dna-core';

export function registerRefreshDnaCommand(context: vscode.ExtensionContext, container: Container) {
  context.subscriptions.push(
    vscode.commands.registerCommand('project-dna.refreshDna', async () => {
      const service = container.resolve<IProjectDNAService>(TOKENS.ProjectDNAService);
      const result = await service.refresh();
      if (isErr(result)) {
        await vscode.window.showErrorMessage(`Project DNA refresh failed: ${result.error.message}`);
        return;
      }
      await vscode.window.showInformationMessage(
        `Project DNA refreshed to version ${result.value.version}.`,
      );
    }),
  );
}
