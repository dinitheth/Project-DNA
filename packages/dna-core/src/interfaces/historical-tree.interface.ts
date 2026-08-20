import type { Result } from '@project-dna/shared';

export interface HistoricalTreeMaterializationOptions {
  readonly maxArchiveBytes?: number;
  readonly maxFiles?: number;
  readonly maxExtractedBytes?: number;
  readonly maxFileBytes?: number;
}

export interface MaterializedHistoricalTree {
  readonly treeSha: string;
  readonly rootPath: string;
  readonly archiveBytes: number;
  readonly extractedBytes: number;
  readonly fileCount: number;
  readonly contentFingerprint: string;
  cleanup(): Promise<void>;
}

export interface IHistoricalTreeMaterializer {
  materialize(
    repositoryRoot: string,
    treeSha: string,
    options?: HistoricalTreeMaterializationOptions,
    signal?: AbortSignal,
  ): Promise<Result<MaterializedHistoricalTree>>;
}
