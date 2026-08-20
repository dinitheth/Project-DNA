import { describe, expect, it } from 'vitest';
import {
  PullRequestImpactOptionsSchema,
  PullRequestImpactRequestSchema,
  PullRequestAnalysisProvenanceSchema,
  pullRequestRequestFingerprint,
} from '../index.js';

const baseSha = '0123456789abcdef0123456789abcdef01234567';
const headSha = 'fedcba9876543210fedcba9876543210fedcba98';
const digest = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('pull request impact contracts', () => {
  it('requires explicit full lowercase base and head SHAs', () => {
    expect(() => PullRequestImpactRequestSchema.parse({ baseSha, headSha })).not.toThrow();
    expect(() => PullRequestImpactRequestSchema.parse({ baseSha: 'HEAD', headSha })).toThrow();
    expect(() =>
      PullRequestImpactRequestSchema.parse({ baseSha: baseSha.slice(0, 8), headSha }),
    ).toThrow();
    expect(() =>
      PullRequestImpactRequestSchema.parse({ baseSha, headSha: headSha.toUpperCase() }),
    ).toThrow();
  });

  it('applies bounded options and produces a stable request fingerprint', () => {
    expect(PullRequestImpactOptionsSchema.parse({})).toMatchObject({
      maxChangedFiles: 500,
      maxTargets: 100,
      maxImpactedEntities: 5_000,
    });
    expect(pullRequestRequestFingerprint({ baseSha, headSha })).toHaveLength(64);
    expect(pullRequestRequestFingerprint({ baseSha, headSha })).toBe(
      pullRequestRequestFingerprint({ baseSha, headSha }),
    );
  });

  it('keeps provenance presentation-independent and serializable', () => {
    const provenance = PullRequestAnalysisProvenanceSchema.parse({
      kind: 'git-pull-request',
      repositoryId: 'repo:test',
      baseCommitSha: baseSha,
      headCommitSha: headSha,
      baseTreeSha: baseSha,
      headTreeSha: headSha,
      mergeBaseSha: null,
      analysisConfigFingerprint: digest,
      baseContentFingerprint: digest,
      headContentFingerprint: digest,
      gitVersion: 'git version 2.47.0',
      renameDetectionPolicy: 'find-renames=50%',
      beforeSource: 'materialized',
      afterSource: 'persisted',
      changedFileFingerprint: digest,
      requestFingerprint: digest,
    });
    expect(JSON.parse(JSON.stringify(provenance))).toEqual(provenance);
  });
});
