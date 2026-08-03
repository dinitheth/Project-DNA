import type { ClassDNA, FileDNA, FunctionDNA } from '@project-dna/dna-core';

export interface TreeSitterExtraction {
  readonly classes: ClassDNA[];
  readonly functions: FunctionDNA[];
  readonly imports: FileDNA['imports'];
  readonly exports: FileDNA['exports'];
  readonly comments: FileDNA['comments'];
  readonly complexity: number;
  readonly linesOfCode: number;
}
