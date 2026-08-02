/**
 * Shared constants used across all packages.
 *
 * Centralized here to avoid magic strings and provide a single source of truth
 * for identifiers, limits, and defaults.
 */

/** Languages supported by the AST engine. */
export const SUPPORTED_LANGUAGES = [
  'typescript',
  'javascript',
  'typescriptreact',
  'javascriptreact',
  'python',
  'java',
  'csharp',
  'go',
  'rust',
  'ruby',
  'php',
  'swift',
  'kotlin',
  'cpp',
  'c',
] as const;

/** Default glob patterns for files/directories to ignore during scanning. */
export const DEFAULT_IGNORE_PATTERNS = [
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  'coverage',
  '.turbo',
  '__pycache__',
  '.pytest_cache',
  'target',
  'bin',
  'obj',
  '.vscode',
  '.idea',
  '*.min.js',
  '*.min.css',
  '*.map',
  '*.lock',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
] as const;

/** Maximum file size (in bytes) that the AST engine will attempt to parse. */
export const FILE_SIZE_LIMIT_BYTES = 1_000_000; // 1 MB

/** VS Code extension identifier. */
export const EXTENSION_ID = 'project-dna.project-dna';

/** Command identifiers registered by the extension. */
export const COMMAND_IDS = {
  analyzeRepository: 'projectDna.analyzeRepository',
  refreshDna: 'projectDna.refreshDna',
  openArchitecture: 'projectDna.openArchitecture',
  openKnowledgeGraph: 'projectDna.openKnowledgeGraph',
  generateDna: 'projectDna.generateDna',
} as const;

/** View identifiers for sidebar panels. */
export const VIEW_IDS = {
  sidebar: 'projectDna.sidebar',
  overview: 'projectDna.overview',
  architecture: 'projectDna.architecture',
  knowledge: 'projectDna.knowledge',
  dependencies: 'projectDna.dependencies',
  settings: 'projectDna.settings',
} as const;
