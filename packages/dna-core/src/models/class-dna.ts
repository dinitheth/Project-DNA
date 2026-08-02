/**
 * ClassDNA — Structural representation of a class declaration.
 */

import { z } from 'zod';

export const ClassDNASchema = z.object({
  /** Unique identifier. */
  id: z.string(),

  /** Class name. */
  name: z.string(),

  /** File path where this class is defined. */
  filePath: z.string(),

  /** Line number where the class declaration starts. */
  startLine: z.number().int().positive(),

  /** Line number where the class declaration ends. */
  endLine: z.number().int().positive(),

  /** Methods defined in this class. */
  methods: z.array(
    z.object({
      name: z.string(),
      visibility: z.enum(['public', 'protected', 'private']),
      isStatic: z.boolean(),
      isAsync: z.boolean(),
      isAbstract: z.boolean(),
      parameters: z.array(
        z.object({
          name: z.string(),
          type: z.string().optional(),
          isOptional: z.boolean(),
        }),
      ),
      returnType: z.string().optional(),
      startLine: z.number().int().positive(),
      endLine: z.number().int().positive(),
      complexity: z.number().nonnegative(),
    }),
  ),

  /** Properties defined in this class. */
  properties: z.array(
    z.object({
      name: z.string(),
      type: z.string().optional(),
      visibility: z.enum(['public', 'protected', 'private']),
      isStatic: z.boolean(),
      isReadonly: z.boolean(),
      isOptional: z.boolean(),
      hasDefaultValue: z.boolean(),
    }),
  ),

  /** Decorators applied to this class. */
  decorators: z.array(z.string()),

  /** Interfaces this class implements. */
  implements: z.array(z.string()),

  /** Superclass this class extends. */
  extends: z.string().optional(),

  /** Whether the class is abstract. */
  isAbstract: z.boolean(),

  /** Whether the class is exported. */
  isExported: z.boolean(),

  /** Overall class visibility. */
  visibility: z.enum(['public', 'protected', 'private', 'default']),
});

export type ClassDNA = z.infer<typeof ClassDNASchema>;
