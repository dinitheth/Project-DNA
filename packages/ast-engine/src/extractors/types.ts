import type { FileDNA } from '@project-dna/dna-core';

export type ImportDNA = FileDNA['imports'][number];
export type ExportDNA = FileDNA['exports'][number];
export type CommentDNA = FileDNA['comments'][number];

export interface DecoratorDNA {
  readonly name: string;
  readonly expression: string;
  readonly targetKind: string;
  readonly targetName: string;
}
