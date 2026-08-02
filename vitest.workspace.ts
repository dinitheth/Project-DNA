import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/shared',
  'packages/dna-core',
  'packages/repository-scanner',
  'packages/ast-engine',
  'packages/dependency-engine',
  'packages/architecture-engine',
  'packages/knowledge-engine',
  'packages/storage',
]);
