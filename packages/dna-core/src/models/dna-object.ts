/**
 * DNAObject — The universal enriched entity.
 *
 * Every repository entity (file, class, function, module) becomes a DNAObject
 * after synthesis. This is the bridge between raw analysis (FileDNA) and
 * understanding (purpose, criticality, health).
 *
 * DESIGN DECISION (S4 from architecture review): Uses a discriminated union
 * base with shared fields, allowing kind-specific data without phantom fields.
 */

import { z } from 'zod';

// ─── Shared Enums ───────────────────────────────────────────────────

export const DNAObjectKindSchema = z.enum(['file', 'class', 'function', 'module', 'package']);
export type DNAObjectKind = z.infer<typeof DNAObjectKindSchema>;

export const ArchitectureRoleSchema = z.enum([
  'controller',
  'service',
  'repository',
  'model',
  'view',
  'middleware',
  'utility',
  'config',
  'test',
  'type-definition',
  'entry-point',
  'barrel',
  'unknown',
]);
export type ArchitectureRole = z.infer<typeof ArchitectureRoleSchema>;

export const CriticalityLevelSchema = z.enum(['critical', 'high', 'medium', 'low']);
export type CriticalityLevel = z.infer<typeof CriticalityLevelSchema>;

// ─── Base Schema (shared by all kinds) ──────────────────────────────

const DNAObjectBaseSchema = z.object({
  /** Unique identifier. */
  id: z.string(),

  /** Entity kind — discriminator field. */
  kind: DNAObjectKindSchema,

  /** Human-readable name. */
  name: z.string(),

  /** Path relative to repository root. */
  path: z.string(),

  // ── Purpose ──
  /** Heuristic-inferred purpose (NOT AI). */
  purpose: z.string(),
  /** Role in the architecture. */
  architectureRole: ArchitectureRoleSchema,
  /** Business domain this entity serves (null if undetermined). */
  businessDomain: z.string().nullable(),

  // ── Importance ──
  /** Importance score (0-1), derived from coupling + centrality. */
  importance: z.number().min(0).max(1),
  /** Criticality classification. */
  criticality: CriticalityLevelSchema,

  // ── Health ──
  /** Aggregate complexity score. */
  complexity: z.number().nonnegative(),
  /** Composite health score (0-1). */
  healthScore: z.number().min(0).max(1),
  /** Associated RiskNode IDs. */
  risks: z.array(z.string()),

  // ── Relationships ──
  /** DNAObject IDs this entity depends on. */
  dependsOn: z.array(z.string()),
  /** DNAObject IDs that depend on this entity. */
  dependedOnBy: z.array(z.string()),
  /** Business domain ID (null if undetermined). */
  belongsToDomain: z.string().nullable(),
  /** Architecture layer ID (null if undetermined). */
  belongsToLayer: z.string().nullable(),

  // ── Knowledge ──
  /** Associated KnowledgeNode IDs. */
  knowledgeNodeIds: z.array(z.string()),
  /** Knowledge density — how well-understood is this entity (0-1). */
  knowledgeDensity: z.number().min(0).max(1),

  // ── Metadata ──
  /** Confidence in this assessment (0-1). */
  confidence: z.number().min(0).max(1),
  /** When this entity was last analyzed. */
  lastAnalyzedAt: z.number(),
});

export const DNAObjectSchema = DNAObjectBaseSchema;
export type DNAObject = z.infer<typeof DNAObjectSchema>;
