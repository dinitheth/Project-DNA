import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/shared',
  'packages/repository-scanner',
  'packages/ast-engine',
  'packages/dependency-engine',
  'packages/architecture-engine',
  'packages/dna-core',
  'packages/evolution-engine',
  'packages/impact-engine',
  'packages/dna-engine',
  'packages/knowledge-engine',
  'packages/software-intelligence-engine',
  'packages/storage',
  'packages/ui-components',
  'apps/vscode-extension',
]);
