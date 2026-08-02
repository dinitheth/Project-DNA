/**
 * FunctionDNA — Structural representation of a function declaration.
 *
 * Covers top-level functions, arrow functions, and generator functions.
 * Method-level functions are captured within ClassDNA.methods.
 */

import { z } from 'zod';

export const FunctionDNASchema = z.object({
  /** Unique identifier. */
  id: z.string(),

  /** Function name (empty string for anonymous functions). */
  name: z.string(),

  /** File path where this function is defined. */
  filePath: z.string(),

  /** Line number where the function starts. */
  startLine: z.number().int().positive(),

  /** Line number where the function ends. */
  endLine: z.number().int().positive(),

  /** Function parameters. */
  parameters: z.array(
    z.object({
      name: z.string(),
      type: z.string().optional(),
      isOptional: z.boolean(),
      isRest: z.boolean(),
      defaultValue: z.string().optional(),
    }),
  ),

  /** Return type annotation (if any). */
  returnType: z.string().optional(),

  /** Whether the function is async. */
  isAsync: z.boolean(),

  /** Whether the function is exported. */
  isExported: z.boolean(),

  /** Whether the function is a generator (function*). */
  isGenerator: z.boolean(),

  /** Whether this is an arrow function expression. */
  isArrow: z.boolean(),

  /** Cyclomatic complexity of the function body. */
  complexity: z.number().nonnegative(),

  /** Decorators applied to this function. */
  decorators: z.array(z.string()),

  /** JSDoc/TSDoc description if present. */
  docComment: z.string().optional(),
});

export type FunctionDNA = z.infer<typeof FunctionDNASchema>;
