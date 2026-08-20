import { describe, expect, it } from 'vitest';
import {
  CommitAnalysisProvenanceSchema,
  CommitChangedFileSchema,
  CommitImpactOptionsSchema,
  CommitImpactRequestSchema,
  CommitImpactResultSchema,
} from '../index.js';

const commitSha = '0123456789abcdef0123456789abcdef01234567';
const digest = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('commit impact contracts', () => {
  it('requires full lowercase commit SHAs and rejects refs', () => {
    expect(() => CommitImpactRequestSchema.parse({ commitSha })).not.toThrow();
    expect(() => CommitImpactRequestSchema.parse({ commitSha: commitSha.slice(0, 8) })).toThrow();
    expect(() => CommitImpactRequestSchema.parse({ commitSha: commitSha.toUpperCase() })).toThrow();
    expect(() => CommitImpactRequestSchema.parse({ commitSha: 'HEAD' })).toThrow();
  });

  it('rejects unsafe absolute, traversal, and NUL-containing paths', () => {
    const valid = {
      path: 'src/index.ts',
      oldBlobSha: null,
      newBlobSha: commitSha,
      oldMode: null,
      newMode: '100644',
      kind: 'added',
      contentKind: 'text',
      binary: false,
      gitlink: false,
    } as const;
    expect(() => CommitChangedFileSchema.parse(valid)).not.toThrow();
    for (const path of [
      '/tmp/file.ts',
      '\\temp\\file.ts',
      'src/../file.ts',
      'src\\..\\file.ts',
      'src/with\0nul.ts',
    ]) {
      expect(() => CommitChangedFileSchema.parse({ ...valid, path })).toThrow();
    }
  });

  it('applies bounded defaults and rejects excessive limits', () => {
    expect(CommitImpactOptionsSchema.parse({})).toEqual({
      maxChangedFiles: 500,
      maxTargets: 100,
      maxImpactedEntities: 5_000,
      maxArchiveBytes: 256 * 1024 * 1024,
      maxFiles: 50_000,
      maxExtractedBytes: 512 * 1024 * 1024,
      maxFileBytes: 64 * 1024 * 1024,
    });
    expect(() => CommitImpactOptionsSchema.parse({ maxTargets: 501 })).toThrow();
    expect(() =>
      CommitImpactOptionsSchema.parse({ maxArchiveBytes: 512 * 1024 * 1024 + 1 }),
    ).toThrow();
  });

  it('keeps provenance and results serializable and bounded', () => {
    const provenance = CommitAnalysisProvenanceSchema.parse({
      kind: 'git-commit',
      repositoryId: 'repo:test',
      commitSha,
      treeSha: commitSha,
      parentCommitSha: null,
      parentTreeSha: null,
      analysisConfigFingerprint: digest,
      contentFingerprint: digest,
      source: 'materialized',
    });
    expect(JSON.parse(JSON.stringify(provenance))).toEqual(provenance);

    const result = CommitImpactResultSchema.parse({
      repositoryId: 'repo:test',
      commitSha,
      parentCommits: [],
      parentCommitSha: null,
      changedFiles: [],
      before: provenance,
      after: { ...provenance, commitSha },
      changeSet: null,
      impacts: [],
      summary: {
        changedEntityIds: [],
        impactedEntityIds: [],
        directDependentIds: [],
        transitiveDependentIds: [],
        domainIds: [],
        capabilityIds: [],
        criticalComponentIds: [],
        riskIds: [],
        architectureLayers: [],
        boundaryEvidence: [],
        highestScore: null,
      },
      unresolved: [],
      warnings: [],
      complete: true,
      truncations: [],
    });
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
});
