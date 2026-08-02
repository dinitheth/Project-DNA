/**
 * KnowledgeNode — A unit of structured knowledge derived from analysis.
 *
 * Knowledge nodes are deterministic, factual observations about the codebase.
 * They are NEVER AI-generated summaries. Examples:
 * - "This module exports 15 public functions"
 * - "Files in src/utils/ follow a single-export convention"
 * - "The project uses barrel exports extensively"
 */

import { z } from 'zod';

export const KnowledgeNodeTypeSchema = z.enum([
  'module',
  'file',
  'class',
  'function',
  'pattern',
  'convention',
  'metric',
  'relationship',
]);

export type KnowledgeNodeType = z.infer<typeof KnowledgeNodeTypeSchema>;

export const KnowledgeNodeSchema = z.object({
  /** Unique identifier. */
  id: z.string(),

  /** What kind of knowledge this node represents. */
  type: KnowledgeNodeTypeSchema,

  /** Human-readable name/label for this knowledge node. */
  name: z.string(),

  /** Arbitrary structured metadata specific to this node type. */
  metadata: z.record(z.unknown()),

  /** Relationships to other knowledge nodes. */
  relationships: z.array(
    z.object({
      /** Target knowledge node ID. */
      targetId: z.string(),
      /** Nature of the relationship. */
      type: z.enum([
        'contains',
        'depends-on',
        'implements',
        'extends',
        'related-to',
        'contradicts',
        'supports',
      ]),
      /** Optional weight/strength of the relationship. */
      weight: z.number().min(0).max(1).optional(),
    }),
  ),

  /** Tags for categorization and search. */
  tags: z.array(z.string()),

  /** The source entity (file path, class name, etc.) this knowledge is about. */
  sourceRef: z.string().optional(),

  /** When this knowledge node was created. */
  createdAt: z.number(),
});

export type KnowledgeNode = z.infer<typeof KnowledgeNodeSchema>;
