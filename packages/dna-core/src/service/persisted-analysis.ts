import { z } from 'zod';
import { BusinessDomainSchema, type BusinessDomain } from '../models/business-domain.js';
import { CapabilitySchema, type Capability } from '../models/capability.js';
import { createSemanticDnaGraph, DNAGraph } from '../models/dna-graph.js';
import { DNAObjectSchema, type DNAObject } from '../models/dna-object.js';
import { EvolutionSnapshotSchema, type EvolutionSnapshot } from '../models/evolution-snapshot.js';
import {
  createProjectDnaSnapshotHash,
  createProjectDnaSnapshotMetrics,
} from '../models/evolution-snapshot.js';
import { KnowledgeNodeSchema, type KnowledgeNode } from '../models/knowledge-node.js';
import { ProjectDNASchema, type ProjectDNA } from '../models/project-dna.js';
import { RepositoryGraph } from '../models/repository-graph.js';
import { createComplexityProfile } from '../models/complexity-profile.js';
import { createRepositoryHealth } from '../models/repository-health.js';
import type { IStoragePort, ITransactionalStoragePort } from '../interfaces/storage.interface.js';

export const STORAGE_NAMESPACES = {
  rootIndex: 'project-dna:root-index',
  latest: 'project-dna:latest',
  aggregate: 'project-dna:aggregate',
  entities: 'project-dna:entities',
  domains: 'project-dna:domains',
  capabilities: 'project-dna:capabilities',
  knowledge: 'project-dna:knowledge',
  dependencyGraph: 'project-dna:dependency-graph',
  dnaGraph: 'project-dna:dna-graph',
  snapshots: 'project-dna:snapshots',
  versionManifest: 'project-dna:version-manifest',
  quarantine: 'project-dna:quarantine',
} as const;

export const VERSION_RECORD_NAMESPACES = [
  STORAGE_NAMESPACES.aggregate,
  STORAGE_NAMESPACES.entities,
  STORAGE_NAMESPACES.domains,
  STORAGE_NAMESPACES.capabilities,
  STORAGE_NAMESPACES.knowledge,
  STORAGE_NAMESPACES.dependencyGraph,
  STORAGE_NAMESPACES.dnaGraph,
  STORAGE_NAMESPACES.snapshots,
] as const;

export const PERSISTED_VERSION_FORMAT = 1;

const LatestAnalysisRecordSchema = z
  .object({
    version: z.number().int().positive(),
    previousVersion: z.number().int().positive().nullable().optional(),
    manifestFormat: z.literal(PERSISTED_VERSION_FORMAT).optional(),
  })
  .superRefine((value, context) => {
    const hasPreviousVersion = value.previousVersion !== undefined;
    const hasManifestFormat = value.manifestFormat !== undefined;
    if (hasPreviousVersion !== hasManifestFormat) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Versioned latest pointers must declare previousVersion and manifestFormat',
      });
    }
    if (value.previousVersion !== null && value.previousVersion !== undefined) {
      if (value.previousVersion >= value.version) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Previous version must be lower than the latest version',
        });
      }
    }
  });

const VersionManifestSchema = z.object({
  formatVersion: z.literal(PERSISTED_VERSION_FORMAT),
  repositoryId: z.string(),
  normalizedRootPath: z.string(),
  version: z.number().int().positive(),
  versionKey: z.string(),
  previousVersion: z.number().int().positive().nullable(),
  requiredNamespaces: z.array(z.string()),
  aggregateId: z.string(),
  snapshotId: z.string(),
  analyzedAt: z.number(),
});

export type LatestAnalysisRecord = z.infer<typeof LatestAnalysisRecordSchema>;
export type VersionManifest = z.infer<typeof VersionManifestSchema>;

export interface PersistedCollections {
  readonly entities: DNAObject[];
  readonly domains: BusinessDomain[];
  readonly capabilities: Capability[];
  readonly knowledge: KnowledgeNode[];
  readonly dependencyGraph: RepositoryGraph;
  readonly dnaGraph: DNAGraph;
}

interface PersistedAnalysisInput {
  readonly repositoryId: string;
  readonly normalizedRootPath: string;
  readonly versionKey: string;
  readonly latest: LatestAnalysisRecord;
  readonly aggregate: unknown;
  readonly entities: unknown;
  readonly domains: unknown;
  readonly capabilities: unknown;
  readonly knowledge: unknown;
  readonly dependencyGraph: unknown;
  readonly dnaGraph: unknown;
  readonly snapshot: unknown;
  readonly manifest: unknown | null;
  readonly persistedVersions?: ReadonlySet<number>;
  readonly previousSnapshotId?: string | null;
  readonly normalizeRootPath: (rootPath: string) => string;
}

export interface ValidatedPersistedAnalysis {
  readonly dna: ProjectDNA;
  readonly collections: PersistedCollections;
  readonly snapshot: EvolutionSnapshot;
}

export function parseLatestAnalysisRecord(value: unknown): LatestAnalysisRecord {
  return LatestAnalysisRecordSchema.parse(value);
}

export function parseVersionManifest(value: unknown): VersionManifest {
  return VersionManifestSchema.parse(value);
}

export function createLatestAnalysisRecord(
  version: number,
  previousVersion: number | null,
): LatestAnalysisRecord {
  return LatestAnalysisRecordSchema.parse({
    version,
    previousVersion,
    manifestFormat: PERSISTED_VERSION_FORMAT,
  });
}

export function createVersionManifest(input: {
  readonly dna: ProjectDNA;
  readonly snapshot: EvolutionSnapshot;
  readonly versionKey: string;
  readonly previousVersion: number | null;
  readonly normalizedRootPath: string;
}): VersionManifest {
  return VersionManifestSchema.parse({
    formatVersion: PERSISTED_VERSION_FORMAT,
    repositoryId: input.dna.id,
    normalizedRootPath: input.normalizedRootPath,
    version: input.dna.version,
    versionKey: input.versionKey,
    previousVersion: input.previousVersion,
    requiredNamespaces: [...VERSION_RECORD_NAMESPACES],
    aggregateId: input.dna.id,
    snapshotId: input.snapshot.id,
    analyzedAt: input.dna.analyzedAt,
  });
}

export function createVersionKey(repositoryId: string, version: number): string {
  return `${repositoryId}:v${version.toString().padStart(8, '0')}`;
}

export function parseVersionKey(repositoryId: string, versionKey: string): number | null {
  const prefix = `${repositoryId}:v`;
  if (!versionKey.startsWith(prefix)) return null;
  const suffix = versionKey.slice(prefix.length);
  if (!/^\d{8,}$/u.test(suffix)) return null;
  const version = Number(suffix);
  if (!Number.isSafeInteger(version) || version <= 0) return null;
  return createVersionKey(repositoryId, version) === versionKey ? version : null;
}

export function validatePersistedAnalysis(
  input: PersistedAnalysisInput,
): ValidatedPersistedAnalysis {
  const hadAnalysisCoverage = hasOwnProperty(input.aggregate, 'analysisCoverage');
  const dna = ProjectDNASchema.parse(input.aggregate);
  const collections: PersistedCollections = {
    entities: DNAObjectSchema.array().parse(input.entities),
    domains: BusinessDomainSchema.array().parse(input.domains),
    capabilities: CapabilitySchema.array().parse(input.capabilities),
    knowledge: KnowledgeNodeSchema.array().parse(input.knowledge),
    dependencyGraph: RepositoryGraph.fromJSON(asSerializedGraph(input.dependencyGraph)),
    dnaGraph: DNAGraph.fromJSON(asSerializedGraph(input.dnaGraph)),
  };
  const snapshot = EvolutionSnapshotSchema.parse(input.snapshot);
  const manifest = input.manifest === null ? null : VersionManifestSchema.parse(input.manifest);

  assertEqual(dna.id, input.repositoryId, 'Aggregate repository ID');
  assertEqual(dna.version, input.latest.version, 'Aggregate version');
  assertEqual(
    input.normalizeRootPath(dna.rootPath),
    input.normalizedRootPath,
    'Aggregate root path',
  );
  assertEqual(dna.entityCount, collections.entities.length, 'Entity count');
  assertEqual(dna.domainCount, collections.domains.length, 'Domain count');
  assertEqual(dna.capabilityCount, collections.capabilities.length, 'Capability count');
  assertEqual(dna.knowledgeNodeCount, collections.knowledge.length, 'Knowledge count');
  assertEqual(snapshot.version, dna.version, 'Evolution snapshot version');
  assertEqual(
    dna.dependencyGraphRef,
    `${STORAGE_NAMESPACES.dependencyGraph}:${input.versionKey}`,
    'Dependency graph reference',
  );
  assertEqual(
    dna.dnaGraphRef,
    `${STORAGE_NAMESPACES.dnaGraph}:${input.versionKey}`,
    'DNA graph reference',
  );
  validateSemanticIntegrity(dna, collections, snapshot, hadAnalysisCoverage);

  if (input.latest.manifestFormat !== undefined && manifest === null) {
    throw new Error(`Persisted version ${input.versionKey} is missing its version manifest`);
  }
  if (manifest !== null) {
    if (input.latest.manifestFormat === undefined) {
      throw new Error(`Persisted version ${input.versionKey} has an unreferenced version manifest`);
    }
    assertEqual(manifest.repositoryId, dna.id, 'Manifest repository ID');
    assertEqual(manifest.normalizedRootPath, input.normalizedRootPath, 'Manifest root path');
    assertEqual(manifest.version, dna.version, 'Manifest version');
    assertEqual(manifest.versionKey, input.versionKey, 'Manifest version key');
    assertEqual(manifest.previousVersion, input.latest.previousVersion ?? null, 'Previous version');
    assertEqual(manifest.aggregateId, dna.id, 'Manifest aggregate ID');
    assertEqual(manifest.snapshotId, snapshot.id, 'Manifest snapshot ID');
    assertEqual(manifest.analyzedAt, dna.analyzedAt, 'Manifest analysis timestamp');
    assertNamespaceList(manifest.requiredNamespaces);
    const expectedPreviousVersion = dna.version === 1 ? null : dna.version - 1;
    assertEqual(manifest.previousVersion, expectedPreviousVersion, 'Manifest version chain');
    if (
      manifest.previousVersion !== null &&
      input.persistedVersions !== undefined &&
      !input.persistedVersions.has(manifest.previousVersion)
    ) {
      throw new Error(
        `Manifest version chain references missing version ${manifest.previousVersion}`,
      );
    }
    if (dna.version === 1) {
      assertEqual(snapshot.parentSnapshotId, null, 'Evolution snapshot parent');
    } else if (input.previousSnapshotId !== undefined) {
      assertEqual(snapshot.parentSnapshotId, input.previousSnapshotId, 'Evolution snapshot parent');
    }
  }

  return { dna, collections, snapshot };
}

function validateSemanticIntegrity(
  dna: ProjectDNA,
  collections: PersistedCollections,
  snapshot: EvolutionSnapshot,
  hadAnalysisCoverage: boolean,
): void {
  const { entities, domains, capabilities, knowledge, dependencyGraph } = collections;
  const entityIds = new Set<string>();
  const entitiesById = new Map<string, DNAObject>();
  for (const entity of entities) {
    assertUniqueStrings(entity.dependsOn, `Dependencies for ${entity.id}`);
    assertUniqueStrings(entity.dependedOnBy, `Dependents for ${entity.id}`);
    assertUniqueStrings(entity.knowledgeNodeIds, `Knowledge references for ${entity.id}`);
    if (entityIds.has(entity.id)) throw new Error(`Duplicate persisted entity ID: ${entity.id}`);
    entityIds.add(entity.id);
    entitiesById.set(entity.id, entity);
  }
  const knowledgeIds = uniqueIds(knowledge, 'knowledge node');
  for (const entity of entities) {
    for (const dependencyId of [...entity.dependsOn, ...entity.dependedOnBy]) {
      if (!entityIds.has(dependencyId)) {
        throw new Error(`Entity ${entity.id} references unknown entity ${dependencyId}`);
      }
    }
    for (const knowledgeId of entity.knowledgeNodeIds) {
      if (!knowledgeIds.has(knowledgeId)) {
        throw new Error(`Entity ${entity.id} references unknown knowledge node ${knowledgeId}`);
      }
    }
  }

  for (const node of knowledge) {
    assertUniqueStrings(
      node.relationships.map((relationship) => `${relationship.type}:${relationship.targetId}`),
      `Knowledge relationships for ${node.id}`,
    );
    for (const relationship of node.relationships) {
      if (!knowledgeIds.has(relationship.targetId)) {
        throw new Error(
          `Knowledge node ${node.id} references unknown knowledge node ${relationship.targetId}`,
        );
      }
    }
  }

  const domainIds = uniqueIds(domains, 'domain');
  for (const domain of domains) {
    assertUniqueStrings(domain.entityIds, `Domain entities for ${domain.id}`);
    assertUniqueStrings(domain.dependsOn, `Domain dependencies for ${domain.id}`);
    assertUniqueStrings(domain.dependedOnBy, `Domain dependents for ${domain.id}`);
    if (domain.fileCount !== domain.entityIds.length) {
      throw new Error(`Domain ${domain.id} file count does not match its entity references`);
    }
    for (const entityId of domain.entityIds) {
      if (!entityIds.has(entityId)) {
        throw new Error(`Domain ${domain.id} references unknown entity ${entityId}`);
      }
      const entity = entitiesById.get(entityId);
      if (entity?.belongsToDomain !== domain.id) {
        throw new Error(`Domain ${domain.id} is inconsistent with entity ${entityId}`);
      }
    }
    for (const dependencyId of [...domain.dependsOn, ...domain.dependedOnBy]) {
      if (!domainIds.has(dependencyId)) {
        throw new Error(`Domain ${domain.id} references unknown domain ${dependencyId}`);
      }
    }
  }
  for (const entity of entities) {
    if (entity.belongsToDomain !== null && !domainIds.has(entity.belongsToDomain)) {
      throw new Error(`Entity ${entity.id} references unknown domain ${entity.belongsToDomain}`);
    }
  }
  const layerIds = new Set(dna.architecture.layers.map((layer) => layer.name));
  for (const entity of entities) {
    if (entity.belongsToLayer !== null && !layerIds.has(entity.belongsToLayer)) {
      throw new Error(
        `Entity ${entity.id} references unknown architecture layer ${entity.belongsToLayer}`,
      );
    }
  }
  const domainsById = new Map(domains.map((domain) => [domain.id, domain]));
  for (const domain of domains) {
    for (const dependencyId of domain.dependsOn) {
      if (!domainsById.get(dependencyId)?.dependedOnBy.includes(domain.id)) {
        throw new Error(`Domain dependency ${domain.id} -> ${dependencyId} is not reciprocal`);
      }
    }
    for (const dependentId of domain.dependedOnBy) {
      if (!domainsById.get(dependentId)?.dependsOn.includes(domain.id)) {
        throw new Error(`Domain dependent ${dependentId} -> ${domain.id} is not reciprocal`);
      }
    }
  }

  uniqueIds(capabilities, 'capability');
  for (const capability of capabilities) {
    assertUniqueStrings(
      capability.implementedBy,
      `Capability implementations for ${capability.id}`,
    );
    for (const entityId of capability.implementedBy) {
      if (!entityIds.has(entityId)) {
        throw new Error(`Capability ${capability.id} references unknown entity ${entityId}`);
      }
    }
  }

  validateDependencyGraph(entities, dependencyGraph);
  validateDnaGraph(dna, collections);
  validateAggregateSemantics(dna, collections, hadAnalysisCoverage);
  validateSnapshot(dna, snapshot);
}

function validateDependencyGraph(entities: readonly DNAObject[], graph: RepositoryGraph): void {
  const entitiesByPath = new Map(entities.map((entity) => [entity.path, entity]));
  const fileNodeIds = graph.getNodesByKind('file');
  if (fileNodeIds.length !== entities.length) {
    throw new Error('Dependency graph file-node count does not match persisted entities');
  }
  for (const entity of entities) {
    const attributes = graph.getNodeAttributes(entity.path);
    if (attributes?.kind !== 'file') {
      throw new Error(`Dependency graph is missing file entity ${entity.id}`);
    }
    const graphDependencies = graph
      .getDependencies(entity.path)
      .filter((id) => graph.getNodeAttributes(id)?.kind === 'file')
      .map((id) => `file:${id}`)
      .sort();
    const graphDependents = graph
      .getDependents(entity.path)
      .filter((id) => graph.getNodeAttributes(id)?.kind === 'file')
      .map((id) => `file:${id}`)
      .sort();
    assertStringArrayEqual(entity.dependsOn, graphDependencies, `Dependencies for ${entity.id}`);
    assertStringArrayEqual(entity.dependedOnBy, graphDependents, `Dependents for ${entity.id}`);
  }
  for (const nodeId of fileNodeIds) {
    if (!entitiesByPath.has(nodeId)) {
      throw new Error(`Dependency graph contains unknown file node ${nodeId}`);
    }
  }
}

function validateDnaGraph(dna: ProjectDNA, collections: PersistedCollections): void {
  const expected = createSemanticDnaGraph({
    entities: collections.entities,
    domains: collections.domains,
    capabilities: collections.capabilities,
    architecture: dna.architecture,
  });
  if (collections.dnaGraph.nodeCount !== expected.nodeCount) {
    throw new Error('DNA graph node count does not match persisted semantic collections');
  }
  for (const nodeId of expected.getNodeIds()) {
    assertDeepEqual(
      collections.dnaGraph.getNodeAttributes(nodeId),
      expected.getNodeAttributes(nodeId),
      `DNA graph node attributes for ${nodeId}`,
    );
  }
  if (collections.dnaGraph.edgeCount !== expected.edgeCount) {
    throw new Error('DNA graph edge count does not match persisted semantic relationships');
  }
  expected.forEachEdge((_edgeId, attributes, source, target) => {
    assertDeepEqual(
      collections.dnaGraph.getEdgeAttributes(source, target),
      attributes,
      `DNA graph edge attributes for ${source} -> ${target}`,
    );
  });
}

function validateAggregateSemantics(
  dna: ProjectDNA,
  collections: PersistedCollections,
  hadAnalysisCoverage: boolean,
): void {
  const { entities } = collections;
  const severityTotal = Object.values(dna.risks.bySeverity).reduce(
    (total, count) => total + count,
    0,
  );
  assertEqual(severityTotal, dna.risks.totalRisks, 'Risk severity total');
  const categoryTotal = Object.values(dna.risks.byCategory).reduce(
    (total, count) => total + count,
    0,
  );
  assertEqual(categoryTotal, dna.risks.totalRisks, 'Risk category total');
  assertEqual(dna.riskCount, dna.risks.totalRisks, 'Aggregate risk count');
  assertDeepEqual(
    dna.complexity,
    createComplexityProfile(entities, dna.complexity.computedAt),
    'Repository complexity profile',
  );
  assertDeepEqual(
    dna.health,
    createRepositoryHealth({
      entities,
      architecture: dna.architecture,
      knowledgeNodes: collections.knowledge,
      riskExposureScore: dna.risks.overallRiskScore,
      lastComputedAt: dna.health.lastComputedAt,
    }),
    'Repository health',
  );

  const entityRiskIds = new Set<string>();
  const affectedEntityCounts = new Map<string, number>();
  for (const entity of entities) {
    assertUniqueStrings(entity.risks, `Risk references for ${entity.id}`);
    for (const riskId of entity.risks) {
      entityRiskIds.add(riskId);
      affectedEntityCounts.set(riskId, (affectedEntityCounts.get(riskId) ?? 0) + 1);
    }
  }
  assertEqual(entityRiskIds.size, dna.risks.totalRisks, 'Persisted entity risk total');
  assertEqual(dna.risks.topRisks.length, Math.min(10, dna.risks.totalRisks), 'Top risk count');
  const topRiskIds = new Set<string>();
  for (const risk of dna.risks.topRisks) {
    if (topRiskIds.has(risk.riskId)) throw new Error(`Duplicate top risk ID: ${risk.riskId}`);
    topRiskIds.add(risk.riskId);
    if (!entityRiskIds.has(risk.riskId)) {
      throw new Error(`Top risk references unknown risk ${risk.riskId}`);
    }
    assertEqual(
      risk.affectedEntityCount,
      affectedEntityCounts.get(risk.riskId) ?? 0,
      `Affected entity count for risk ${risk.riskId}`,
    );
  }
  if (dna.risks.totalRisks <= 10) {
    const severityWeights = { info: 1, low: 2, medium: 4, high: 7, critical: 10 } as const;
    const exposure = dna.risks.topRisks.reduce(
      (total, risk) =>
        total + severityWeights[risk.severity] * Math.max(1, risk.affectedEntityCount),
      0,
    );
    assertEqual(
      dna.risks.overallRiskScore,
      Math.round(100 * (1 - Math.exp(-exposure / 25))),
      'Repository risk exposure',
    );
  }

  const entityIds = new Set(entities.map((entity) => entity.id));
  uniqueIds(dna.criticalComponents, 'critical component');
  for (const component of dna.criticalComponents) {
    if (!entityIds.has(component.entityId)) {
      throw new Error(
        `Critical component ${component.id} references unknown entity ${component.entityId}`,
      );
    }
  }

  if (hadAnalysisCoverage && dna.analysisCoverage) {
    const accounted =
      dna.analysisCoverage.parsed + dna.analysisCoverage.skipped + dna.analysisCoverage.failed;
    assertEqual(accounted, dna.analysisCoverage.scanned, 'Analysis coverage total');
    assertEqual(dna.analysisCoverage.parsed, dna.entityCount, 'Parsed entity count');
  }
}

function validateSnapshot(dna: ProjectDNA, snapshot: EvolutionSnapshot): void {
  assertEqual(
    snapshot.projectDnaHash,
    createProjectDnaSnapshotHash(dna),
    'Evolution snapshot Project DNA hash',
  );
  const expectedMetrics = createProjectDnaSnapshotMetrics(dna);
  const actualKeys = Object.keys(snapshot.metrics).sort();
  const expectedKeys = Object.keys(expectedMetrics).sort();
  assertStringArrayEqual(actualKeys, expectedKeys, 'Evolution snapshot metric keys');
  for (const key of expectedKeys) {
    assertEqual(snapshot.metrics[key], expectedMetrics[key], `Evolution snapshot metric ${key}`);
  }
}

function uniqueIds<T extends { readonly id: string }>(
  values: readonly T[],
  label: string,
): Set<string> {
  const ids = new Set<string>();
  for (const value of values) {
    if (ids.has(value.id)) throw new Error(`Duplicate persisted ${label} ID: ${value.id}`);
    ids.add(value.id);
  }
  return ids;
}

function assertStringArrayEqual(
  actual: readonly string[],
  expected: readonly string[],
  label: string,
): void {
  const normalizedActual = [...actual].sort();
  const normalizedExpected = [...expected].sort();
  if (
    normalizedActual.length !== normalizedExpected.length ||
    normalizedActual.some((value, index) => value !== normalizedExpected[index])
  ) {
    throw new Error(`${label} mismatch`);
  }
}

function assertUniqueStrings(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} contains duplicate references`);
  }
}

function hasOwnProperty(value: unknown, key: string): boolean {
  return typeof value === 'object' && value !== null && Object.hasOwn(value, key);
}

function assertNamespaceList(actual: readonly string[]): void {
  if (
    actual.length !== VERSION_RECORD_NAMESPACES.length ||
    actual.some((namespace, index) => namespace !== VERSION_RECORD_NAMESPACES[index])
  ) {
    throw new Error('Version manifest contains an invalid required namespace list');
  }
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label} mismatch: expected ${String(expected)}, received ${String(actual)}`);
  }
}

function assertDeepEqual(actual: unknown, expected: unknown, label: string): void {
  if (stableJson(actual) !== stableJson(expected)) throw new Error(`${label} mismatch`);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function asSerializedGraph(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Persisted graph must be a serialized object');
  }
  return value as Record<string, unknown>;
}

export function isTransactionalStorage(
  storage: IStoragePort,
): storage is ITransactionalStoragePort {
  return (
    'applyAtomically' in storage &&
    typeof (storage as { readonly applyAtomically?: unknown }).applyAtomically === 'function'
  );
}
