/**
 * ComplexityAnalyzer — Computes the ComplexityProfile from entity data.
 *
 * Measures cyclomatic complexity distribution, nesting depth,
 * coupling metrics, and instability indices.
 */

import type { Logger } from '@project-dna/shared';
import {
  createComplexityProfile,
  type DNAObject,
  type ComplexityProfile,
} from '@project-dna/dna-core';

export class ComplexityAnalyzer {
  constructor(private readonly logger: Logger) {}

  compute(entities: DNAObject[]): ComplexityProfile {
    this.logger.info('Computing complexity profile...');
    return createComplexityProfile(entities);
  }
}
