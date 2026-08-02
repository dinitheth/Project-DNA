/**
 * ProjectDNA — The Aggregate Root.
 *
 * The sole entry point for querying the intelligence platform.
 * Immutable once produced — mutations create a new version.
 *
 * DESIGN DECISION (C2 fix): This aggregate is LIGHTWEIGHT.
 * It holds identity, profile, summaries, health, and story — always in memory.
 * Heavyweight collections (entities, knowledge, graphs) are NOT embedded.
 * They are accessed via IProjectDNAQuery methods, loaded on demand from storage.
 *
 * DESIGN DECISION (C2/S3 fix): Evolution is NOT part of ProjectDNA.
 * ProjectDNA represents "what IS". Evolution represents "what CHANGED".
 * Evolution is queried via IProjectDNAEvolution.
 */

import { z } from 'zod';
import { ArchitectureDNASchema } from './architecture-dna.js';
import { RepositoryProfileSchema } from './repository-profile.js';
import { RepositoryHealthSchema } from './repository-health.js';
import { ComplexityProfileSchema } from './complexity-profile.js';
import { RiskAssessmentSchema } from './risk-assessment.js';
import { CriticalComponentSchema } from './critical-component.js';
import { RepositoryStorySchema } from './repository-story.js';

export const AnalysisConfigSchema = z.object({
  /** Maximum file size to analyze (bytes). */
  maxFileSize: z.number().int().positive(),
  /** Glob patterns to ignore. */
  ignorePatterns: z.array(z.string()),
  /** Languages to analyze (empty = all supported). */
  languages: z.array(z.string()),
  /** Complexity threshold for "high complexity" classification. */
  complexityThreshold: z.number().positive(),
  /** Criticality factor weights. */
  criticalityWeights: z.object({
    centrality: z.number().min(0).max(1),
    fanIn: z.number().min(0).max(1),
    fanOut: z.number().min(0).max(1),
    complexity: z.number().min(0).max(1),
    size: z.number().min(0).max(1),
  }),
});

export type AnalysisConfig = z.infer<typeof AnalysisConfigSchema>;

export const ProjectDNASchema = z.object({
  // ── Identity ──
  /** Stable repository identifier (hash of rootPath). */
  id: z.string(),
  /** Monotonically increasing analysis version. */
  version: z.number().int().nonnegative(),
  /** When this analysis was produced. */
  analyzedAt: z.number(),
  /** Repository root path. */
  rootPath: z.string(),

  // ── Profile (what IS this software?) ──
  profile: RepositoryProfileSchema,

  // ── Structure (summaries only — full data loaded on demand) ──
  architecture: ArchitectureDNASchema,
  /** Count of detected modules. */
  moduleCount: z.number().int().nonnegative(),
  /** Count of enriched entities (files + classes + functions). */
  entityCount: z.number().int().nonnegative(),

  // ── Intelligence (always loaded — small data) ──
  health: RepositoryHealthSchema,
  complexity: ComplexityProfileSchema,
  risks: RiskAssessmentSchema,
  /** Critical components (typically < 50 items). */
  criticalComponents: z.array(CriticalComponentSchema),

  // ── Knowledge (summary counts — full data loaded on demand) ──
  /** Number of inferred business domains. */
  domainCount: z.number().int().nonnegative(),
  /** Number of detected capabilities. */
  capabilityCount: z.number().int().nonnegative(),
  /** Number of knowledge nodes. */
  knowledgeNodeCount: z.number().int().nonnegative(),
  /** Number of detected risks. */
  riskCount: z.number().int().nonnegative(),

  // ── Graphs (storage references — loaded on demand) ──
  /** Storage key for the DependencyGraph. */
  dependencyGraphRef: z.string(),
  /** Storage key for the DNAGraph. */
  dnaGraphRef: z.string(),

  // ── Story ──
  story: RepositoryStorySchema,

  // ── Meta ──
  /** Configuration that produced this analysis. */
  analysisConfig: AnalysisConfigSchema,
  /** Total pipeline duration in milliseconds. */
  durationMs: z.number().nonnegative(),
});

export type ProjectDNA = z.infer<typeof ProjectDNASchema>;
