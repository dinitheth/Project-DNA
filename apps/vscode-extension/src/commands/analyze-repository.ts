import * as vscode from 'vscode';
import { Container, TOKENS, isErr } from '@project-dna/shared';
import type { IProjectDNAService } from '@project-dna/dna-core';

export function registerAnalyzeRepositoryCommand(
  context: vscode.ExtensionContext,
  container: Container,
) {
  context.subscriptions.push(
    vscode.commands.registerCommand('project-dna.analyzeRepository', async () => {
      const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!rootPath) {
        await vscode.window.showWarningMessage('Project DNA: Open a workspace folder first.');
        return;
      }
      const service = container.resolve<IProjectDNAService>(TOKENS.ProjectDNAService);
      const result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Project DNA: Analyzing repository',
          cancellable: true,
        },
        async (progress, cancellation) => {
          const controller = new AbortController();
          const cancellationSubscription = cancellation.onCancellationRequested(() =>
            controller.abort(),
          );
          const unsubscribe = service.onProgress((update) => {
            progress.report({ message: `${update.message} (${update.percent}%)` });
          });
          try {
            return await service.analyze(rootPath, controller.signal);
          } finally {
            unsubscribe();
            cancellationSubscription.dispose();
          }
        },
      );
      if (isErr(result)) {
        await vscode.window.showErrorMessage(
          `Project DNA analysis failed: ${result.error.message}`,
        );
        return;
      }
      await vscode.window.showInformationMessage(
        `Project DNA ready: ${result.value.entityCount} entities, health ${result.value.health.overallScore}/100`,
      );
    }),
  );
}
