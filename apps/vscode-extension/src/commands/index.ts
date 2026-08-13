import * as vscode from 'vscode';
import { Container } from '@project-dna/shared';
import type { SidebarProvider } from '../sidebar/sidebar-provider.js';
import { registerAnalyzeRepositoryCommand } from './analyze-repository';
import { registerRefreshDnaCommand } from './refresh-dna';
import { registerOpenArchitectureCommand } from './open-architecture';
import { registerOpenKnowledgeGraphCommand } from './open-knowledge-graph';
import { registerGenerateDnaCommand } from './generate-dna';

export function registerAllCommands(
  context: vscode.ExtensionContext,
  container: Container,
  sidebarProvider: SidebarProvider,
) {
  registerAnalyzeRepositoryCommand(context, container);
  registerRefreshDnaCommand(context, container);
  registerOpenArchitectureCommand(context, sidebarProvider);
  registerOpenKnowledgeGraphCommand(context, sidebarProvider);
  registerGenerateDnaCommand(context, container);
}
