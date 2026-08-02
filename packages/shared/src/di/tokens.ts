/**
 * DI tokens for all injectable dependencies.
 *
 * Each token is a unique Symbol that acts as a type-safe key for the DI container.
 * Tokens are organized by domain area. New packages should add their tokens here
 * to maintain a single source of truth for the dependency graph.
 */
export const TOKENS = {
  // ─── Core ──────────────────────────────────────────────────────────
  Logger: Symbol.for('dna.Logger'),
  EventBus: Symbol.for('dna.EventBus'),
  Orchestrator: Symbol.for('dna.Orchestrator'),

  // ─── Engines ───────────────────────────────────────────────────────
  RepositoryScanner: Symbol.for('dna.RepositoryScanner'),
  AstEngine: Symbol.for('dna.AstEngine'),
  DependencyEngine: Symbol.for('dna.DependencyEngine'),
  ArchitectureEngine: Symbol.for('dna.ArchitectureEngine'),
  KnowledgeEngine: Symbol.for('dna.KnowledgeEngine'),
  DNAEngine: Symbol.for('dna.DNAEngine'),
  IntelligenceEngine: Symbol.for('dna.IntelligenceEngine'),
  EvolutionEngine: Symbol.for('dna.EvolutionEngine'),

  // ─── Storage ───────────────────────────────────────────────────────
  StoragePort: Symbol.for('dna.StoragePort'),

  // ─── Service ───────────────────────────────────────────────────────
  ProjectDNAService: Symbol.for('dna.ProjectDNAService'),

  // ─── Extension ─────────────────────────────────────────────────────
  ExtensionContext: Symbol.for('dna.ExtensionContext'),
  SidebarProvider: Symbol.for('dna.SidebarProvider'),
} as const;
