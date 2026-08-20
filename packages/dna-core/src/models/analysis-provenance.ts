import { z } from 'zod';
import { CommitAnalysisProvenanceSchema } from './commit-impact.js';

export const AnalysisSourceProvenanceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('git-working-tree'),
    headCommit: z.string().regex(/^[0-9a-f]{4,}$/u),
    contentFingerprint: z.string().regex(/^[0-9a-f]{64}$/u),
    clean: z.boolean(),
    gitVersion: z.string().min(1),
  }),
  CommitAnalysisProvenanceSchema,
]);

export type AnalysisSourceProvenance = Readonly<z.infer<typeof AnalysisSourceProvenanceSchema>>;
