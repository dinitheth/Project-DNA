/**
 * RepositoryStory — Deterministic narrative intelligence.
 *
 * Template-driven narrative assembled from structured data.
 * Every sentence maps to a measurable fact.
 * NOT AI-generated prose — deterministic template output.
 * Designed with locale support from day one.
 */

import { z } from 'zod';

export const RepositoryStorySchema = z.object({
  /** High-level summary of the repository. */
  summary: z.string(),

  /** Architecture description. */
  architectureSummary: z.string(),

  /** Business domain summary. */
  domainSummary: z.string(),

  /** Health narrative. */
  healthSummary: z.string(),

  /** Critical path description. */
  criticalPath: z.string(),

  /** Deterministic risk sentences. */
  risks: z.array(z.string()),

  /** Locale used for this story. */
  locale: z.string().default('en'),

  /** Template version used to generate this story. */
  templateVersion: z.string(),

  /** When this story was generated. */
  generatedAt: z.number(),
});

export type RepositoryStory = z.infer<typeof RepositoryStorySchema>;
