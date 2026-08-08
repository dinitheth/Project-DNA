import { createHash } from 'node:crypto';
import { Err, Ok, isErr, type Logger, type Result } from '@project-dna/shared';
import type {
  IStorageInspectionPort,
  IStoragePort,
  StorageMutation,
  StoragePrecondition,
  StorageRecordEvidence,
} from '../interfaces/storage.interface.js';
import { EvolutionSnapshotSchema, type EvolutionSnapshot } from '../models/evolution-snapshot.js';
import {
  STORAGE_NAMESPACES,
  VERSION_RECORD_NAMESPACES,
  PERSISTED_VERSION_FORMAT,
  createLatestAnalysisRecord,
  createVersionManifest,
  isTransactionalStorage,
  parseLatestAnalysisRecord,
  parseVersionKey,
  parseVersionManifest,
  validatePersistedAnalysis,
  type LatestAnalysisRecord,
  type ValidatedPersistedAnalysis,
  type VersionManifest,
} from './persisted-analysis.js';

const VERSION_NAMESPACES = [
  ...VERSION_RECORD_NAMESPACES,
  STORAGE_NAMESPACES.versionManifest,
] as const;

type StoredEvidence =
  | {
      readonly namespace: string;
      readonly key: string;
      readonly status: 'missing';
    }
  | {
      readonly namespace: string;
      readonly key: string;
      readonly status: 'loaded';
      readonly value: unknown;
      readonly rawValue?: string;
      readonly metadata?: Omit<StorageRecordEvidence, 'value'>;
    }
  | {
      readonly namespace: string;
      readonly key: string;
      readonly status: 'unreadable';
      readonly error: string;
      readonly rawValue?: string;
      readonly metadata?: Omit<StorageRecordEvidence, 'value'>;
    };

interface ValidCandidate extends ValidatedPersistedAnalysis {
  readonly versionKey: string;
  readonly latest: LatestAnalysisRecord;
  readonly hasManifest: boolean;
}

interface ParsedPointer {
  readonly latest: LatestAnalysisRecord | null;
  readonly invalidReason: string | null;
}

interface RecoveryCandidateMetadata {
  readonly versionKey: string;
  readonly version: number;
  readonly snapshot: EvolutionSnapshot;
}

type CandidateEvaluation =
  | {
      readonly kind: 'valid';
      readonly candidate: ValidCandidate;
    }
  | {
      readonly kind: 'cleanup';
    }
  | {
      readonly kind: 'quarantine';
      readonly reason: string;
    };

type MetadataEvaluation =
  | {
      readonly kind: 'valid';
      readonly metadata: RecoveryCandidateMetadata;
    }
  | {
      readonly kind: 'cleanup';
    }
  | {
      readonly kind: 'quarantine';
      readonly reason: string;
    };

export interface RecoveryResult {
  readonly analysis: ValidatedPersistedAnalysis | null;
  readonly latest: LatestAnalysisRecord | null;
  readonly snapshots: EvolutionSnapshot[];
}

export class PersistedAnalysisRecoveryManager {
  constructor(
    private readonly storage: IStoragePort,
    private readonly logger: Logger,
  ) {}

  async recover(input: {
    readonly repositoryId: string;
    readonly normalizedRootPath: string;
    readonly normalizeRootPath: (rootPath: string) => string;
  }): Promise<Result<RecoveryResult>> {
    try {
      const pointerEvidence = await this.readRecord(STORAGE_NAMESPACES.latest, input.repositoryId);
      const pointer = parsePointer(pointerEvidence);
      const manifestPointerVersion = declaredManifestVersion(pointerEvidence);
      const rootEvidence = await this.readRecord(
        STORAGE_NAMESPACES.rootIndex,
        input.normalizedRootPath,
      );
      const versionKeys = await this.discoverVersionKeys(input.repositoryId);
      const candidates: RecoveryCandidateMetadata[] = [];
      const validVersions = new Set<number>();
      const snapshotIds = new Map<number, string>();

      for (const versionKey of versionKeys) {
        const version = parseVersionKey(input.repositoryId, versionKey);
        if (version === null) {
          await this.cleanupVersion(versionKey, await this.readVersionEvidence(versionKey));
          this.logger.warn(`Removed malformed persisted version key ${versionKey}`);
          continue;
        }

        const metadataEvidence = await this.readVersionMetadata(versionKey);
        const requiredRecordsExist = await this.requiredVersionRecordsExist(versionKey);
        const metadataEvaluation = this.evaluateMetadata({
          repositoryId: input.repositoryId,
          normalizedRootPath: input.normalizedRootPath,
          versionKey,
          version,
          manifestPointerVersion,
          validVersions,
          snapshotIds,
          evidence: metadataEvidence,
          requiredRecordsExist,
        });

        if (metadataEvaluation.kind === 'cleanup') {
          const evidence = await this.readVersionEvidence(versionKey);
          await this.cleanupVersion(versionKey, evidence);
          this.logger.warn(`Removed incomplete persisted version ${versionKey}`);
          continue;
        }
        if (metadataEvaluation.kind === 'quarantine') {
          const evidence = await this.readVersionEvidence(versionKey);
          await this.quarantineVersion(
            input.repositoryId,
            versionKey,
            evidence,
            metadataEvaluation.reason,
          );
          continue;
        }

        validVersions.add(version);
        snapshotIds.set(version, metadataEvaluation.metadata.snapshot.id);
        candidates.push(metadataEvaluation.metadata);
      }

      let selected: ValidCandidate | null = null;
      for (let index = candidates.length - 1; index >= 0; index--) {
        const metadata = candidates[index];
        if (!metadata) continue;
        let evidence = await this.readVersionValues(metadata.versionKey);
        let evaluation = this.evaluateCandidate({
          repositoryId: input.repositoryId,
          normalizedRootPath: input.normalizedRootPath,
          normalizeRootPath: input.normalizeRootPath,
          versionKey: metadata.versionKey,
          version: metadata.version,
          manifestPointerVersion,
          validVersions,
          snapshotIds,
          evidence,
        });
        if (evaluation.kind !== 'valid') {
          evidence = await this.readVersionEvidence(metadata.versionKey);
          evaluation = this.evaluateCandidate({
            repositoryId: input.repositoryId,
            normalizedRootPath: input.normalizedRootPath,
            normalizeRootPath: input.normalizeRootPath,
            versionKey: metadata.versionKey,
            version: metadata.version,
            manifestPointerVersion,
            validVersions,
            snapshotIds,
            evidence,
          });
        }
        if (evaluation.kind === 'cleanup') {
          await this.cleanupVersion(metadata.versionKey, evidence);
          this.logger.warn(`Removed incomplete persisted version ${metadata.versionKey}`);
        } else if (evaluation.kind === 'quarantine') {
          await this.quarantineVersion(
            input.repositoryId,
            metadata.versionKey,
            evidence,
            evaluation.reason,
          );
        } else {
          selected = evaluation.candidate;
          break;
        }
        validVersions.delete(metadata.version);
        snapshotIds.delete(metadata.version);
        candidates.splice(index, 1);
      }

      const snapshots = candidates.map((candidate) => candidate.snapshot);
      const promoted = selected
        ? this.prepareSelectedPromotion(
            selected,
            manifestPointerVersion !== null,
            input.normalizedRootPath,
          )
        : null;
      await this.repairPointers({
        repositoryId: input.repositoryId,
        normalizedRootPath: input.normalizedRootPath,
        pointerEvidence,
        pointer,
        rootEvidence,
        desired: promoted?.latest ?? null,
        legacyManifest: promoted?.manifest ?? null,
        legacyManifestKey: promoted?.manifest ? (selected?.versionKey ?? null) : null,
      });

      if (!selected || !promoted) {
        return Ok({ analysis: null, latest: null, snapshots: [] });
      }

      this.logger.info(
        `Recovered Project DNA v${selected.dna.version} from ${selected.versionKey}`,
      );
      return Ok({ analysis: selected, latest: promoted.latest, snapshots });
    } catch (error) {
      return Err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private prepareSelectedPromotion(
    selected: ValidCandidate,
    requiresManifestPointer: boolean,
    normalizedRootPath: string,
  ): { readonly latest: LatestAnalysisRecord; readonly manifest: VersionManifest | null } {
    if (selected.hasManifest || !requiresManifestPointer) {
      return { latest: selected.latest, manifest: null };
    }
    const previousVersion = selected.dna.version === 1 ? null : selected.dna.version - 1;
    return {
      latest: createLatestAnalysisRecord(selected.dna.version, previousVersion),
      manifest: createVersionManifest({
        dna: selected.dna,
        snapshot: selected.snapshot,
        versionKey: selected.versionKey,
        previousVersion,
        normalizedRootPath,
      }),
    };
  }

  private async discoverVersionKeys(repositoryId: string): Promise<string[]> {
    const prefix = `${repositoryId}:v`;
    const keys = new Set<string>();
    for (const namespace of VERSION_NAMESPACES) {
      const listed = await this.storage.list(namespace);
      if (isErr(listed)) throw listed.error;
      for (const key of listed.value) {
        if (key.startsWith(prefix)) keys.add(key);
      }
    }
    return [...keys].sort((left, right) => {
      const leftVersion = parseVersionKey(repositoryId, left);
      const rightVersion = parseVersionKey(repositoryId, right);
      if (leftVersion !== null && rightVersion !== null) return leftVersion - rightVersion;
      if (leftVersion !== null) return -1;
      if (rightVersion !== null) return 1;
      return left.localeCompare(right);
    });
  }

  private async readVersionEvidence(versionKey: string): Promise<StoredEvidence[]> {
    const evidence: StoredEvidence[] = [];
    for (const namespace of VERSION_NAMESPACES) {
      evidence.push(await this.readRecord(namespace, versionKey));
    }
    return evidence;
  }

  private async readVersionMetadata(versionKey: string): Promise<StoredEvidence[]> {
    return Promise.all([
      this.readRecord(STORAGE_NAMESPACES.versionManifest, versionKey),
      this.readRecord(STORAGE_NAMESPACES.snapshots, versionKey),
    ]);
  }

  private async requiredVersionRecordsExist(versionKey: string): Promise<boolean> {
    for (const namespace of VERSION_RECORD_NAMESPACES) {
      const exists = await this.storage.exists(namespace, versionKey);
      if (isErr(exists)) throw exists.error;
      if (!exists.value) return false;
    }
    return true;
  }

  private async readVersionValues(versionKey: string): Promise<StoredEvidence[]> {
    const values: StoredEvidence[] = [];
    for (const namespace of VERSION_NAMESPACES) {
      const loaded = await this.storage.load<unknown>(namespace, versionKey);
      if (!isErr(loaded)) {
        values.push({ namespace, key: versionKey, status: 'loaded', value: loaded.value });
        continue;
      }
      const exists = await this.storage.exists(namespace, versionKey);
      if (isErr(exists)) throw exists.error;
      values.push(
        exists.value
          ? { namespace, key: versionKey, status: 'unreadable', error: loaded.error.message }
          : { namespace, key: versionKey, status: 'missing' },
      );
    }
    return values;
  }

  private evaluateMetadata(input: {
    readonly repositoryId: string;
    readonly normalizedRootPath: string;
    readonly versionKey: string;
    readonly version: number;
    readonly manifestPointerVersion: number | null;
    readonly validVersions: ReadonlySet<number>;
    readonly snapshotIds: ReadonlyMap<number, string>;
    readonly evidence: readonly StoredEvidence[];
    readonly requiredRecordsExist: boolean;
  }): MetadataEvaluation {
    if (input.evidence.some((record) => record.status === 'unreadable')) {
      return { kind: 'quarantine', reason: 'Unreadable recovery metadata' };
    }
    if (!input.requiredRecordsExist) return { kind: 'cleanup' };

    const values = new Map(
      input.evidence
        .filter(
          (record): record is Extract<StoredEvidence, { status: 'loaded' }> =>
            record.status === 'loaded',
        )
        .map((record) => [record.namespace, record.value] as const),
    );
    if (!values.has(STORAGE_NAMESPACES.snapshots)) return { kind: 'cleanup' };
    const hasManifest = values.has(STORAGE_NAMESPACES.versionManifest);
    if (!hasManifest && input.version === input.manifestPointerVersion) {
      return {
        kind: 'quarantine',
        reason: `Persisted M3 version ${input.versionKey} is missing its version manifest`,
      };
    }

    try {
      const snapshot = EvolutionSnapshotSchema.parse(values.get(STORAGE_NAMESPACES.snapshots));
      assertRecoveryEqual(snapshot.version, input.version, 'Evolution snapshot version');
      if (input.version === 1) {
        assertRecoveryEqual(snapshot.parentSnapshotId, null, 'Evolution snapshot parent');
      }

      if (hasManifest) {
        const manifest = parseVersionManifest(values.get(STORAGE_NAMESPACES.versionManifest));
        assertRecoveryEqual(manifest.repositoryId, input.repositoryId, 'Manifest repository ID');
        assertRecoveryEqual(
          manifest.normalizedRootPath,
          input.normalizedRootPath,
          'Manifest root path',
        );
        assertRecoveryEqual(manifest.version, input.version, 'Manifest version');
        assertRecoveryEqual(manifest.versionKey, input.versionKey, 'Manifest version key');
        assertRecoveryEqual(manifest.aggregateId, input.repositoryId, 'Manifest aggregate ID');
        assertRecoveryEqual(manifest.snapshotId, snapshot.id, 'Manifest snapshot ID');
        assertRecoveryNamespaces(manifest.requiredNamespaces);
        const expectedPreviousVersion = input.version === 1 ? null : input.version - 1;
        assertRecoveryEqual(
          manifest.previousVersion,
          expectedPreviousVersion,
          'Manifest version chain',
        );
        if (
          manifest.previousVersion !== null &&
          !input.validVersions.has(manifest.previousVersion)
        ) {
          throw new Error(
            `Manifest version chain references missing version ${manifest.previousVersion}`,
          );
        }
        if (input.version > 1) {
          assertRecoveryEqual(
            snapshot.parentSnapshotId,
            input.snapshotIds.get(input.version - 1) ?? null,
            'Evolution snapshot parent',
          );
        }
      } else if (
        input.manifestPointerVersion !== null &&
        input.version > 1 &&
        !input.validVersions.has(input.version - 1)
      ) {
        return {
          kind: 'quarantine',
          reason: `Legacy fallback ${input.versionKey} has no validated predecessor version ${input.version - 1}`,
        };
      }

      return {
        kind: 'valid',
        metadata: {
          versionKey: input.versionKey,
          version: input.version,
          snapshot,
        },
      };
    } catch (error) {
      return { kind: 'quarantine', reason: errorMessage(error) };
    }
  }

  private evaluateCandidate(input: {
    readonly repositoryId: string;
    readonly normalizedRootPath: string;
    readonly normalizeRootPath: (rootPath: string) => string;
    readonly versionKey: string;
    readonly version: number;
    readonly manifestPointerVersion: number | null;
    readonly validVersions: ReadonlySet<number>;
    readonly snapshotIds: ReadonlyMap<number, string>;
    readonly evidence: readonly StoredEvidence[];
  }): CandidateEvaluation {
    if (input.evidence.some((record) => record.status === 'unreadable')) {
      return { kind: 'quarantine', reason: 'Unreadable record' };
    }
    if (
      input.evidence.some(
        (record) =>
          record.namespace !== STORAGE_NAMESPACES.versionManifest && record.status === 'missing',
      )
    ) {
      return { kind: 'cleanup' };
    }

    const values = new Map(
      input.evidence
        .filter(
          (record): record is Extract<StoredEvidence, { status: 'loaded' }> =>
            record.status === 'loaded',
        )
        .map((record) => [record.namespace, record.value] as const),
    );
    const hasManifest = values.has(STORAGE_NAMESPACES.versionManifest);
    if (!hasManifest && input.version === input.manifestPointerVersion) {
      return {
        kind: 'quarantine',
        reason: `Persisted M3 version ${input.versionKey} is missing its version manifest`,
      };
    }

    try {
      const manifestValue = hasManifest ? values.get(STORAGE_NAMESPACES.versionManifest) : null;
      const promotesLegacyIntoManifestChain = !hasManifest && input.manifestPointerVersion !== null;
      const latest = hasManifest
        ? createLatestAnalysisRecord(
            input.version,
            parseVersionManifest(manifestValue).previousVersion,
          )
        : ({ version: input.version } satisfies LatestAnalysisRecord);
      const validated = validatePersistedAnalysis({
        repositoryId: input.repositoryId,
        normalizedRootPath: input.normalizedRootPath,
        versionKey: input.versionKey,
        latest,
        aggregate: requiredValue(values, STORAGE_NAMESPACES.aggregate),
        entities: requiredValue(values, STORAGE_NAMESPACES.entities),
        domains: requiredValue(values, STORAGE_NAMESPACES.domains),
        capabilities: requiredValue(values, STORAGE_NAMESPACES.capabilities),
        knowledge: requiredValue(values, STORAGE_NAMESPACES.knowledge),
        dependencyGraph: requiredValue(values, STORAGE_NAMESPACES.dependencyGraph),
        dnaGraph: requiredValue(values, STORAGE_NAMESPACES.dnaGraph),
        snapshot: requiredValue(values, STORAGE_NAMESPACES.snapshots),
        manifest: manifestValue,
        persistedVersions: input.validVersions,
        previousSnapshotId:
          (hasManifest || promotesLegacyIntoManifestChain) && input.version > 1
            ? (input.snapshotIds.get(input.version - 1) ?? null)
            : undefined,
        normalizeRootPath: input.normalizeRootPath,
      });
      if (
        !hasManifest &&
        input.manifestPointerVersion !== null &&
        input.version > 1 &&
        !input.validVersions.has(input.version - 1)
      ) {
        return {
          kind: 'quarantine',
          reason: `Legacy fallback ${input.versionKey} has no validated predecessor version ${input.version - 1}`,
        };
      }
      return {
        kind: 'valid',
        candidate: { ...validated, versionKey: input.versionKey, latest, hasManifest },
      };
    } catch (error) {
      return { kind: 'quarantine', reason: errorMessage(error) };
    }
  }

  private async readRecord(namespace: string, key: string): Promise<StoredEvidence> {
    const exists = await this.storage.exists(namespace, key);
    if (isErr(exists)) throw exists.error;
    if (!exists.value) return { namespace, key, status: 'missing' };

    if (isInspectionStorage(this.storage)) {
      const inspected = await this.storage.inspect(namespace, key);
      if (isErr(inspected)) {
        return { namespace, key, status: 'unreadable', error: inspected.error.message };
      }
      const metadata = {
        createdAt: inspected.value.createdAt,
        updatedAt: inspected.value.updatedAt,
      };
      try {
        return {
          namespace,
          key,
          status: 'loaded',
          value: JSON.parse(inspected.value.value) as unknown,
          rawValue: inspected.value.value,
          metadata,
        };
      } catch (error) {
        return {
          namespace,
          key,
          status: 'unreadable',
          error: errorMessage(error),
          rawValue: inspected.value.value,
          metadata,
        };
      }
    }

    const loaded = await this.storage.load<unknown>(namespace, key);
    return isErr(loaded)
      ? { namespace, key, status: 'unreadable', error: loaded.error.message }
      : { namespace, key, status: 'loaded', value: loaded.value };
  }

  private async cleanupVersion(
    versionKey: string,
    evidence: readonly StoredEvidence[],
  ): Promise<void> {
    await this.applyMutations(
      VERSION_NAMESPACES.map((namespace) => ({
        type: 'delete' as const,
        namespace,
        key: versionKey,
      })),
      evidence.map(evidencePreconditionRequired),
    );
  }

  private async quarantineVersion(
    repositoryId: string,
    versionKey: string,
    evidence: readonly StoredEvidence[],
    reason: string,
  ): Promise<void> {
    const quarantine = {
      formatVersion: 1,
      kind: 'version',
      repositoryId,
      versionKey,
      reason,
      records: evidence,
      rawEvidenceLimitation: isInspectionStorage(this.storage)
        ? null
        : 'The configured storage adapter does not expose raw persisted values or record metadata.',
    } as const;
    const quarantineKey = createQuarantineKey(`version:${versionKey}`, quarantine);
    await this.applyMutations(
      [
        {
          type: 'save',
          namespace: STORAGE_NAMESPACES.quarantine,
          key: quarantineKey,
          data: quarantine,
        },
        ...VERSION_NAMESPACES.map((namespace) => ({
          type: 'delete' as const,
          namespace,
          key: versionKey,
        })),
      ],
      evidence.map(evidencePreconditionRequired),
    );
    this.logger.warn(`Quarantined corrupted persisted version ${versionKey}: ${reason}`);
  }

  private async repairPointers(input: {
    readonly repositoryId: string;
    readonly normalizedRootPath: string;
    readonly pointerEvidence: StoredEvidence;
    readonly pointer: ParsedPointer;
    readonly rootEvidence: StoredEvidence;
    readonly desired: LatestAnalysisRecord | null;
    readonly legacyManifest: VersionManifest | null;
    readonly legacyManifestKey: string | null;
  }): Promise<void> {
    const latestMatches =
      input.pointer.invalidReason === null &&
      latestRecordsEqual(input.pointer.latest, input.desired);
    const rootMatches =
      input.rootEvidence.status === 'loaded' && input.rootEvidence.value === input.repositoryId;
    const rootNeedsMutation =
      input.desired === null ? input.rootEvidence.status !== 'missing' : !rootMatches;
    if (latestMatches && !rootNeedsMutation && input.legacyManifest === null) return;

    const mutations: StorageMutation[] = [];
    if (input.pointer.invalidReason !== null) {
      const quarantine = {
        formatVersion: 1,
        kind: 'latest-pointer',
        repositoryId: input.repositoryId,
        reason: input.pointer.invalidReason,
        record: input.pointerEvidence,
        rawEvidenceLimitation: isInspectionStorage(this.storage)
          ? null
          : 'The configured storage adapter does not expose raw persisted values or record metadata.',
      } as const;
      mutations.push({
        type: 'save',
        namespace: STORAGE_NAMESPACES.quarantine,
        key: createQuarantineKey(`latest:${input.repositoryId}`, quarantine),
        data: quarantine,
      });
    }
    if (input.legacyManifest && input.legacyManifestKey) {
      mutations.push({
        type: 'save',
        namespace: STORAGE_NAMESPACES.versionManifest,
        key: input.legacyManifestKey,
        data: input.legacyManifest,
      });
    }
    if (rootNeedsMutation) {
      mutations.push(
        input.desired === null
          ? {
              type: 'delete',
              namespace: STORAGE_NAMESPACES.rootIndex,
              key: input.normalizedRootPath,
            }
          : {
              type: 'save',
              namespace: STORAGE_NAMESPACES.rootIndex,
              key: input.normalizedRootPath,
              data: input.repositoryId,
            },
      );
    }
    if (!latestMatches) {
      mutations.push(
        input.desired === null
          ? { type: 'delete', namespace: STORAGE_NAMESPACES.latest, key: input.repositoryId }
          : {
              type: 'save',
              namespace: STORAGE_NAMESPACES.latest,
              key: input.repositoryId,
              data: input.desired,
            },
      );
    }

    if (isTransactionalStorage(this.storage)) {
      const preconditions: StoragePrecondition[] = [];
      if (!latestMatches) {
        const latestPrecondition = evidencePrecondition(input.pointerEvidence);
        if (latestPrecondition === null) {
          await this.applyMutations(
            mutations.filter((mutation) => mutation.namespace === STORAGE_NAMESPACES.quarantine),
          );
          throw new Error(
            'Cannot safely repair unreadable latest pointer because the storage adapter does not expose its raw value',
          );
        }
        preconditions.push(latestPrecondition);
      }
      if (rootNeedsMutation) preconditions.push(evidencePreconditionRequired(input.rootEvidence));
      if (input.legacyManifest && input.legacyManifestKey) {
        preconditions.push({
          type: 'missing',
          namespace: STORAGE_NAMESPACES.versionManifest,
          key: input.legacyManifestKey,
        });
      }
      const applied = await this.storage.applyAtomically({ preconditions, mutations });
      if (isErr(applied)) throw applied.error;
    } else {
      await this.applyMutations(mutations);
    }

    this.logger.info(
      input.desired === null
        ? `Removed orphan latest pointer for ${input.repositoryId}`
        : `Repaired latest pointer for ${input.repositoryId} to v${input.desired.version}`,
    );
  }

  private async applyMutations(
    mutations: readonly StorageMutation[],
    preconditions: readonly StoragePrecondition[] = [],
  ): Promise<void> {
    if (mutations.length === 0) return;
    if (isTransactionalStorage(this.storage)) {
      const applied = await this.storage.applyAtomically({ preconditions, mutations });
      if (isErr(applied)) throw applied.error;
      return;
    }
    for (const mutation of mutations) {
      const applied =
        mutation.type === 'save'
          ? await this.storage.save(mutation.namespace, mutation.key, mutation.data)
          : await this.storage.delete(mutation.namespace, mutation.key);
      if (isErr(applied)) throw applied.error;
    }
  }
}

function parsePointer(evidence: StoredEvidence): ParsedPointer {
  if (evidence.status === 'missing') return { latest: null, invalidReason: null };
  if (evidence.status === 'unreadable') {
    return { latest: null, invalidReason: evidence.error };
  }
  try {
    return { latest: parseLatestAnalysisRecord(evidence.value), invalidReason: null };
  } catch (error) {
    return { latest: null, invalidReason: errorMessage(error) };
  }
}

function declaredManifestVersion(evidence: StoredEvidence): number | null {
  if (
    evidence.status !== 'loaded' ||
    typeof evidence.value !== 'object' ||
    evidence.value === null
  ) {
    return null;
  }
  const value = evidence.value as Record<string, unknown>;
  return value['manifestFormat'] === PERSISTED_VERSION_FORMAT &&
    Number.isSafeInteger(value['version']) &&
    Number(value['version']) > 0
    ? Number(value['version'])
    : null;
}

function evidencePrecondition(evidence: StoredEvidence): StoragePrecondition | null {
  if (evidence.status === 'missing') {
    return { type: 'missing', namespace: evidence.namespace, key: evidence.key };
  }
  if (evidence.status === 'loaded') {
    if (evidence.rawValue !== undefined) {
      return {
        type: 'raw-equals',
        namespace: evidence.namespace,
        key: evidence.key,
        value: evidence.rawValue,
      };
    }
    return {
      type: 'equals',
      namespace: evidence.namespace,
      key: evidence.key,
      data: evidence.value,
    };
  }
  return evidence.rawValue === undefined
    ? null
    : {
        type: 'raw-equals',
        namespace: evidence.namespace,
        key: evidence.key,
        value: evidence.rawValue,
      };
}

function evidencePreconditionRequired(evidence: StoredEvidence): StoragePrecondition {
  const precondition = evidencePrecondition(evidence);
  if (precondition === null) {
    throw new Error(
      `Cannot safely update ${evidence.namespace}/${evidence.key} without raw storage evidence`,
    );
  }
  return precondition;
}

function isInspectionStorage(storage: IStoragePort): storage is IStorageInspectionPort {
  return (
    'inspect' in storage &&
    typeof (storage as { readonly inspect?: unknown }).inspect === 'function'
  );
}

function requiredValue(values: ReadonlyMap<string, unknown>, namespace: string): unknown {
  if (!values.has(namespace)) throw new Error(`Missing required persisted record ${namespace}`);
  return values.get(namespace);
}

function assertRecoveryNamespaces(namespaces: readonly string[]): void {
  if (
    namespaces.length !== VERSION_RECORD_NAMESPACES.length ||
    namespaces.some((namespace, index) => namespace !== VERSION_RECORD_NAMESPACES[index])
  ) {
    throw new Error('Version manifest contains an invalid required namespace list');
  }
}

function assertRecoveryEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label} mismatch: expected ${String(expected)}, received ${String(actual)}`);
  }
}

function latestRecordsEqual(
  left: LatestAnalysisRecord | null,
  right: LatestAnalysisRecord | null,
): boolean {
  if (left === null || right === null) return left === right;
  return (
    left.version === right.version &&
    left.previousVersion === right.previousVersion &&
    left.manifestFormat === right.manifestFormat
  );
}

function createQuarantineKey(prefix: string, value: unknown): string {
  const hash = createHash('sha256').update(JSON.stringify(value)).digest('hex');
  return `${prefix}:${hash}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
