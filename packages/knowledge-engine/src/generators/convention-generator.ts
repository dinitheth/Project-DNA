/**
 * @module ConventionGenerator
 * Detects coding conventions from the repository.
 */
import type { FileDNA, RepositoryDNA, KnowledgeNode } from '@project-dna/dna-core';

export class ConventionGenerator {
  public generate(_files: FileDNA[], _repository: RepositoryDNA): KnowledgeNode[] {
    // TODO: detect coding conventions (file naming, folder structure).
    return [];
  }
}
