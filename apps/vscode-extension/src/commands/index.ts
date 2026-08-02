import * as vscode from 'vscode';
import { Container } from '@project-dna/shared';
import { registerAnalyzeRepositoryCommand } from './analyze-repository';
import { registerRefreshDnaCommand } from './refresh-dna';
import { registerOpenArchitectureCommand } from './open-architecture';
import { registerOpenKnowledgeGraphCommand } from './open-knowledge-graph';
import { registerGenerateDnaCommand } from './generate-dna';

export function registerAllCommands(context: vscode.ExtensionContext, container: Container) {
  registerAnalyzeRepositoryCommand(context, container);
  registerRefreshDnaCommand(context, container);
  registerOpenArchitectureCommand(context, container);
  registerOpenKnowledgeGraphCommand(context, container);
  registerGenerateDnaCommand(context, container);
}
