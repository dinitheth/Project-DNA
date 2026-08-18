import { Err, Ok, type Result } from '@project-dna/shared';
import {
  ImpactOptionsSchema,
  ImpactResultSchema,
  ImpactTargetSchema,
  RISK_SEVERITY_WEIGHTS,
  createRepositoryGraphFromAnalysisState,
  traverseDependencyGraph,
  type ArchitectureDNA,
  type DNAObject,
  type ImpactEvidence,
  type ImpactNode,
  type ImpactOptions,
  type ImpactPath,
  type ImpactResult,
  type ImpactSemanticEffects,
  type ImpactScore,
  type ImpactScoreComponent,
  type ImpactScoreComponentStatus,
  type ImpactTarget,
  type ImpactEngineInput,
  type AnalysisStateView,
  type RepositoryGraph,
} from '@project-dna/dna-core';

export type { ImpactEngineInput, ImpactSemanticInput } from '@project-dna/dna-core';

const FILE_ENTITY_PREFIX = 'file:';

/** Calculates bounded structural blast radius for canonical file graph nodes. */
export class ImpactEngine {
  getImpact(
    input: ImpactEngineInput,
    target: ImpactTarget,
    options: Partial<ImpactOptions> = {},
    signal?: AbortSignal,
  ): Result<ImpactResult> {
    try {
      if (signal?.aborted) return Err(new Error('Impact analysis cancelled'));
      const parsedTarget = parseTarget(target);
      if (!parsedTarget.ok) return parsedTarget;
      const parsedOptions = ImpactOptionsSchema.safeParse(options);
      if (!parsedOptions.success) {
        return Err(new Error(`Invalid impact options: ${parsedOptions.error.message}`));
      }
      if (!input.repositoryId.trim()) return Err(new Error('Impact repository ID is required'));
      if (!Number.isSafeInteger(input.analysisVersion) || input.analysisVersion < 0) {
        return Err(new Error('Impact analysis version must be a safe nonnegative integer'));
      }
      if (
        input.expectedAnalysisVersion !== undefined &&
        (!Number.isSafeInteger(input.expectedAnalysisVersion) || input.expectedAnalysisVersion < 0)
      ) {
        return Err(
          new Error('Expected impact analysis version must be a safe nonnegative integer'),
        );
      }
      if (
        input.expectedAnalysisVersion !== undefined &&
        input.expectedAnalysisVersion !== input.analysisVersion
      ) {
        return Err(
          new Error(
            `Stale impact analysis version: expected ${input.expectedAnalysisVersion}, received ${input.analysisVersion}`,
          ),
        );
      }
      if (input.state.repositoryId !== input.repositoryId) {
        return Err(new Error('Impact analysis state repository does not match the request'));
      }
      if (input.state.analysisVersion !== input.analysisVersion) {
        return Err(new Error('Impact analysis state version does not match the request'));
      }

      const graph = createRepositoryGraphFromAnalysisState(input.state);
      const resolvedTarget = resolveFileTarget(graph, parsedTarget.value);
      if (!resolvedTarget.ok) return resolvedTarget;
      const targetId = resolvedTarget.value;
      const targetNode = createImpactNode(graph, targetId, 0);
      if (!targetNode.ok) return targetNode;

      const traversal = traverseDependencyGraph(
        {
          graphs: [graph],
          startIds: [targetId],
          options: {
            direction: 'dependents',
            maxDepth: parsedOptions.data.maxDepth,
            maxEntities: parsedOptions.data.maxEntities,
          },
        },
        signal,
      );
      if (!traversal.ok) return traversal;
      if (signal?.aborted) return Err(new Error('Impact analysis cancelled'));

      const traversalById = new Map(traversal.value.nodes.map((node) => [node.id, node]));
      const impacted: ImpactNode[] = [];
      for (const node of traversal.value.nodes) {
        const impactedNode = createImpactNode(graph, node.id, node.minimumDepth);
        if (!impactedNode.ok) return impactedNode;
        impacted.push(impactedNode.value);
      }
      impacted.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
      const directImpactedEntities = impacted.filter((node) => node.minimumDepth === 1);
      const transitiveImpactedEntities = impacted.filter((node) => node.minimumDepth > 1);
      const allCanonicalPaths: ImpactPath[] = [];
      const evidence: ImpactEvidence[] = [];
      for (const [index, node] of impacted.entries()) {
        if (signal?.aborted) return Err(new Error('Impact analysis cancelled'));
        const path = buildCanonicalPath(targetId, toGraphId(node.id), traversalById);
        if (!path.ok) return path;
        allCanonicalPaths.push(path.value);
        const reason = node.minimumDepth === 1 ? 'direct-dependent' : 'transitive-dependent';
        evidence.push({
          id: `evidence:${node.id}:${reason}`,
          entityId: node.id,
          reason,
          path: index < parsedOptions.data.maxEvidencePaths ? path.value : null,
          sourcePath: node.path,
          confidence: 1,
        });
      }

      const canonicalPaths = allCanonicalPaths.slice(0, parsedOptions.data.maxEvidencePaths);
      const truncations = traversal.value.truncations.map((truncation) => ({
        ...truncation,
        atEntityId: truncation.atEntityId === null ? null : toEntityId(truncation.atEntityId),
      }));
      const firstOmittedPath = impacted[parsedOptions.data.maxEvidencePaths];
      if (firstOmittedPath) {
        truncations.push({
          kind: 'max-evidence-paths',
          limit: parsedOptions.data.maxEvidencePaths,
          atEntityId: firstOmittedPath.id,
        });
      }

      const semantic = enrichSemanticImpact(
        input.state,
        new Set([targetNode.value.id, ...impacted.map((node) => node.id)]),
        canonicalPaths,
        parsedOptions.data.maxEntities,
      );

      const result = ImpactResultSchema.safeParse({
        repositoryId: input.repositoryId,
        analysisVersion: input.analysisVersion,
        target: targetNode.value,
        directImpactedEntities,
        transitiveImpactedEntities,
        minimumDepth:
          impacted.length > 0 ? Math.min(...impacted.map((node) => node.minimumDepth)) : null,
        canonicalPaths,
        semanticEffects: semantic.effects,
        score: calculateScore({
          impacted,
          semantic: semantic.effects,
          evidence: [...evidence, ...semantic.evidence],
          truncations,
          semanticInput: input.state,
          warnings: semantic.warnings,
        }),
        evidence: [...evidence, ...semantic.evidence],
        warnings: semantic.warnings,
        complete: truncations.length === 0,
        truncations,
        appliedBounds: {
          maxDepth: parsedOptions.data.maxDepth,
          maxEntities: parsedOptions.data.maxEntities,
          maxEvidencePaths: parsedOptions.data.maxEvidencePaths,
        },
      });
      return result.success
        ? Ok(result.data)
        : Err(new Error(`Impact result validation failed: ${result.error.message}`));
    } catch (error) {
      return Err(error instanceof Error ? error : new Error(String(error)));
    }
  }
}

function parseTarget(target: ImpactTarget): Result<ImpactTarget> {
  const parsed = ImpactTargetSchema.safeParse(target);
  if (parsed.success) return Ok(parsed.data);
  const kind = isRecord(target) && typeof target.kind === 'string' ? target.kind : null;
  return Err(
    new Error(
      kind && kind !== 'file' && kind !== 'entity'
        ? `Unsupported impact target kind: ${kind}`
        : `Invalid impact target: ${parsed.error.message}`,
    ),
  );
}

function resolveFileTarget(graph: RepositoryGraph, target: ImpactTarget): Result<string> {
  const rawId = target.kind === 'file' ? target.path : target.id;
  const graphId = rawId.startsWith(FILE_ENTITY_PREFIX)
    ? rawId.slice(FILE_ENTITY_PREFIX.length)
    : rawId;
  const direct = resolveDirectNode(graph, graphId);
  if (direct.ok) return direct;

  const pathCandidates = [graphId];
  const normalizedCandidates = new Set(pathCandidates.map(normalizePath));
  const matches = graph
    .getNodesByKind('file')
    .filter((id) => {
      const attributes = graph.getNodeAttributes(id);
      return (
        normalizedCandidates.has(normalizePath(id)) ||
        (attributes?.path !== undefined && normalizedCandidates.has(normalizePath(attributes.path)))
      );
    })
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  if (matches.length === 1) return Ok(matches[0]!);
  if (matches.length > 1) {
    return Err(new Error(`Impact target is ambiguous: ${rawId}`));
  }
  return Err(new Error(`Impact target does not resolve to a supported file entity: ${rawId}`));
}

function resolveDirectNode(graph: RepositoryGraph, id: string): Result<string> {
  if (!graph.hasNode(id)) return Err(new Error('not a direct graph node'));
  const attributes = graph.getNodeAttributes(id);
  if (attributes?.kind !== 'file') {
    return Err(
      new Error(`Impact target node kind is unsupported: ${attributes?.kind ?? 'unknown'}`),
    );
  }
  return Ok(id);
}

function createImpactNode(
  graph: RepositoryGraph,
  id: string,
  minimumDepth: number,
): Result<ImpactNode> {
  const attributes = graph.getNodeAttributes(id);
  if (!attributes || attributes.kind !== 'file') {
    return Err(new Error(`Impact graph node is not a supported file: ${id}`));
  }
  return Ok({
    id: toEntityId(id),
    kind: 'file',
    name: attributes.label,
    path: attributes.path ?? id,
    minimumDepth,
  });
}

function buildCanonicalPath(
  targetId: string,
  impactedId: string,
  traversalById: ReadonlyMap<
    string,
    {
      readonly predecessorId: string;
      readonly relationship: ImpactPath['relationships'][number];
    }
  >,
): Result<ImpactPath> {
  const reverseNodeIds = [impactedId];
  const reverseRelationships: ImpactPath['relationships'] = [];
  let currentId = impactedId;
  const seen = new Set<string>();
  while (currentId !== targetId) {
    if (seen.has(currentId)) return Err(new Error(`Impact path cycle detected at ${currentId}`));
    seen.add(currentId);
    const current = traversalById.get(currentId);
    if (!current) return Err(new Error(`Impact path predecessor is missing for ${currentId}`));
    reverseRelationships.push(current.relationship);
    currentId = current.predecessorId;
    reverseNodeIds.push(currentId);
  }
  const nodeIds = reverseNodeIds.reverse();
  const relationships = reverseRelationships.reverse();
  return Ok({
    impactedEntityId: toEntityId(impactedId),
    nodeIds: nodeIds.map(toEntityId),
    relationships: relationships.map((relationship) => ({
      ...relationship,
      dependentId: toEntityId(relationship.dependentId),
      dependencyId: toEntityId(relationship.dependencyId),
    })),
  });
}

function toEntityId(graphId: string): string {
  return graphId.startsWith(FILE_ENTITY_PREFIX) ? graphId : `${FILE_ENTITY_PREFIX}${graphId}`;
}

function toGraphId(entityId: string): string {
  return entityId.startsWith(FILE_ENTITY_PREFIX)
    ? entityId.slice(FILE_ENTITY_PREFIX.length)
    : entityId;
}

interface SemanticEnrichment {
  readonly effects: ImpactSemanticEffects;
  readonly evidence: ImpactEvidence[];
  readonly warnings: string[];
}

function enrichSemanticImpact(
  input: AnalysisStateView,
  scope: ReadonlySet<string>,
  canonicalPaths: readonly ImpactPath[],
  maxEntities: number,
): SemanticEnrichment {
  const warnings: string[] = [];
  const evidence: ImpactEvidence[] = [];
  const entities = input.entities;
  const entityById = new Map((entities ?? []).map((entity) => [entity.id, entity]));
  const pathByEntity = new Map(canonicalPaths.map((path) => [path.impactedEntityId, path]));

  const domains = enrichCollection(
    input.domains,
    'domains',
    (domain) => [...domain.entityIds].sort().find((entityId) => scope.has(entityId)),
    (domain, entityId) =>
      semanticEvidence(
        'domain-membership',
        domain.id,
        entityId!,
        entityById,
        pathByEntity,
        domain.confidence,
      ),
    evidence,
    warnings,
    maxEntities,
  );
  const capabilities = enrichCollection(
    input.capabilities,
    'capabilities',
    (capability) => [...capability.implementedBy].sort().find((entityId) => scope.has(entityId)),
    (capability, entityId) =>
      semanticEvidence(
        'capability-implementation',
        capability.id,
        entityId!,
        entityById,
        pathByEntity,
        capability.confidence,
      ),
    evidence,
    warnings,
    maxEntities,
  );
  const criticalComponents = enrichCollection(
    input.criticalComponents,
    'critical components',
    (component) => (scope.has(component.entityId) ? component.entityId : undefined),
    (component, entityId) =>
      semanticEvidence(
        'critical-component',
        component.id,
        entityId!,
        entityById,
        pathByEntity,
        component.score,
      ),
    evidence,
    warnings,
    maxEntities,
  );
  const risks = enrichCollection(
    input.risks,
    'risks',
    (risk) =>
      [...risk.affectedEntities]
        .map(toFileEntityId)
        .sort()
        .find((entityId) => scope.has(entityId)),
    (risk, entityId) =>
      semanticEvidence(
        'risk-reference',
        risk.id,
        entityId!,
        entityById,
        pathByEntity,
        1,
        normalizePath(toGraphId(entityId!)),
      ),
    evidence,
    warnings,
    maxEntities,
  );

  let layers: ArchitectureDNA['layers'] = [];
  const boundaryCrossings: ImpactSemanticEffects['architecture']['boundaryCrossings'] = [];
  if (input.architecture === null) {
    warnings.push('Semantic enrichment incomplete: architecture layers unavailable');
  } else if (entities.length === 0) {
    warnings.push('Semantic enrichment incomplete: entities unavailable for layer membership');
  } else {
    const layerNames = new Set(
      entities
        .filter((entity) => scope.has(entity.id) && entity.belongsToLayer !== null)
        .map((entity) => entity.belongsToLayer as string),
    );
    layers = input.architecture.layers
      .filter((layer) => layerNames.has(layer.name))
      .sort((left, right) => compareIds(left.name, right.name))
      .slice(0, maxEntities);
    if (
      input.architecture.layers.filter((layer) => layerNames.has(layer.name)).length > maxEntities
    ) {
      warnings.push(`Semantic enrichment truncated architecture layers to ${maxEntities}`);
    }
    for (const layer of layers) {
      const entityId = [...entityById.values()]
        .filter((entity) => scope.has(entity.id) && entity.belongsToLayer === layer.name)
        .map((entity) => entity.id)
        .sort(compareIds)[0];
      if (entityId) {
        evidence.push(
          semanticEvidence(
            'architecture-layer-membership',
            layer.name,
            entityId,
            entityById,
            pathByEntity,
            input.architecture.confidence,
          ),
        );
      }
    }
    if (scope.size > 1 && canonicalPaths.length === 0) {
      warnings.push(
        'Semantic enrichment incomplete: canonical paths unavailable for layer crossings',
      );
    }
    const crossingByKey = new Map<
      string,
      ImpactSemanticEffects['architecture']['boundaryCrossings'][number]
    >();
    for (const path of canonicalPaths) {
      for (const relationship of path.relationships) {
        const dependencyLayer = entityById.get(relationship.dependencyId)?.belongsToLayer;
        const dependentLayer = entityById.get(relationship.dependentId)?.belongsToLayer;
        if (!dependencyLayer || !dependentLayer || dependencyLayer === dependentLayer) continue;
        const crossing = {
          fromLayer: dependencyLayer,
          toLayer: dependentLayer,
          dependentId: relationship.dependentId,
          dependencyId: relationship.dependencyId,
        };
        crossingByKey.set(
          `${crossing.fromLayer}:${crossing.toLayer}:${crossing.dependentId}:${crossing.dependencyId}`,
          crossing,
        );
      }
    }
    boundaryCrossings.push(
      ...[...crossingByKey.values()].sort((left, right) =>
        compareIds(
          `${left.fromLayer}:${left.toLayer}:${left.dependentId}:${left.dependencyId}`,
          `${right.fromLayer}:${right.toLayer}:${right.dependentId}:${right.dependencyId}`,
        ),
      ),
    );
    for (const crossing of boundaryCrossings) {
      evidence.push(
        semanticEvidence(
          'layer-boundary',
          `${crossing.fromLayer}:${crossing.toLayer}:${crossing.dependentId}:${crossing.dependencyId}`,
          crossing.dependentId,
          entityById,
          pathByEntity,
          input.architecture.confidence,
        ),
      );
    }
  }

  return {
    effects: {
      domains,
      capabilities,
      criticalComponents,
      risks,
      architecture: { layers, boundaryCrossings },
    },
    evidence,
    warnings,
  };
}

function enrichCollection<T extends { readonly id: string }>(
  values: readonly T[] | null | undefined,
  label: string,
  match: (value: T) => string | undefined,
  addEvidence: (value: T, entityId: string | undefined) => ImpactEvidence,
  evidence: ImpactEvidence[],
  warnings: string[],
  maxEntities: number,
): T[] {
  if (values === undefined || values === null) {
    warnings.push(`Semantic enrichment incomplete: ${label} unavailable`);
    return [];
  }
  const matched = [...values]
    .map((value) => ({ value, entityId: match(value) }))
    .filter((item): item is { value: T; entityId: string } => item.entityId !== undefined)
    .sort(
      (left, right) =>
        compareIds(left.value.id, right.value.id) ||
        compareIds(canonicalValueKey(left.value), canonicalValueKey(right.value)),
    );
  const unique = matched.filter(
    (item, index, items) => index === 0 || item.value.id !== items[index - 1]!.value.id,
  );
  if (unique.length > maxEntities) {
    warnings.push(`Semantic enrichment truncated ${label} to ${maxEntities}`);
  }
  for (const item of unique.slice(0, maxEntities)) {
    evidence.push(addEvidence(item.value, item.entityId));
  }
  return unique.slice(0, maxEntities).map((item) => item.value);
}

function semanticEvidence(
  reason: ImpactEvidence['reason'],
  semanticId: string,
  entityId: string,
  entities: ReadonlyMap<string, DNAObject>,
  paths: ReadonlyMap<string, ImpactPath>,
  confidence: number,
  fallbackSourcePath: string | null = null,
): ImpactEvidence {
  return {
    id: `evidence:semantic:${reason}:${semanticId}:${entityId}`,
    entityId,
    reason,
    path: paths.get(entityId) ?? null,
    sourcePath: entities.get(entityId)?.path ?? fallbackSourcePath,
    confidence,
  };
}

function toFileEntityId(value: string): string {
  return value.startsWith(FILE_ENTITY_PREFIX)
    ? value
    : `${FILE_ENTITY_PREFIX}${normalizePath(value)}`;
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

interface ScoreInput {
  readonly impacted: readonly ImpactNode[];
  readonly semantic: ImpactSemanticEffects;
  readonly evidence: readonly ImpactEvidence[];
  readonly truncations: readonly { readonly kind: string }[];
  readonly semanticInput: AnalysisStateView;
  readonly warnings: readonly string[];
}

const SCORE_WEIGHTS = {
  'dependency-reach': 0.35,
  'critical-component-exposure': 0.25,
  'domain-reach': 0.15,
  'risk-exposure': 0.15,
  'architecture-boundaries': 0.1,
} as const;

// Each component is normalized independently, then contributes normalized * weight * 100.
function calculateScore(input: ScoreInput): ImpactScore {
  const structuralPartial = input.truncations.some(
    (truncation) => truncation.kind === 'max-depth' || truncation.kind === 'max-entities',
  );
  const pathPartial = input.truncations.some(
    (truncation) => truncation.kind === 'max-evidence-paths',
  );
  const components = [
    scoreComponent(
      'dependency-reach',
      input.impacted.length,
      countNormalization(input.impacted.length),
      structuralPartial ? 'partial' : 'available',
      evidenceIds(input.evidence, ['direct-dependent', 'transitive-dependent']),
    ),
    scoreComponent(
      'critical-component-exposure',
      sum(input.semantic.criticalComponents.map((component) => component.score)),
      probabilityNormalization(
        input.semantic.criticalComponents.map((component) => component.score),
      ),
      semanticStatus(
        input.semanticInput?.criticalComponents,
        structuralPartial,
        input.warnings,
        'critical components',
      ),
      evidenceIds(input.evidence, ['critical-component']),
    ),
    scoreComponent(
      'domain-reach',
      input.semantic.domains.length,
      countNormalization(input.semantic.domains.length),
      semanticStatus(input.semanticInput?.domains, structuralPartial, input.warnings, 'domains'),
      evidenceIds(input.evidence, ['domain-membership']),
    ),
    scoreComponent(
      'risk-exposure',
      sum(input.semantic.risks.map((risk) => RISK_SEVERITY_WEIGHTS[risk.severity])),
      probabilityNormalization(
        input.semantic.risks.map((risk) => RISK_SEVERITY_WEIGHTS[risk.severity] / 10),
      ),
      semanticStatus(input.semanticInput?.risks, structuralPartial, input.warnings, 'risks'),
      evidenceIds(input.evidence, ['risk-reference']),
    ),
    scoreComponent(
      'architecture-boundaries',
      input.semantic.architecture.boundaryCrossings.length,
      countNormalization(input.semantic.architecture.boundaryCrossings.length),
      semanticStatus(
        input.semanticInput?.architecture,
        structuralPartial || pathPartial,
        input.warnings,
        'architecture layers',
      ),
      evidenceIds(input.evidence, ['layer-boundary']),
    ),
  ];
  return {
    total: round(components.reduce((total, component) => total + component.contribution, 0)),
    components,
  };
}

function scoreComponent(
  kind: ImpactScoreComponent['kind'],
  rawInput: number,
  normalizedValue: number,
  status: ImpactScoreComponentStatus,
  evidenceIds: string[],
): ImpactScoreComponent {
  const normalized = status === 'unavailable' ? 0 : clamp(normalizedValue);
  return {
    kind,
    rawInput: status === 'unavailable' ? 0 : rawInput,
    normalizedValue: normalized,
    weight: SCORE_WEIGHTS[kind],
    contribution: round(normalized * SCORE_WEIGHTS[kind] * 100),
    evidenceIds: [...evidenceIds].sort(compareIds),
    status,
  };
}

function semanticStatus(
  values: readonly unknown[] | object | null | undefined,
  structuralPartial: boolean,
  warnings: readonly string[],
  label: string,
): ImpactScoreComponentStatus {
  if (values === undefined || values === null) return 'unavailable';
  return structuralPartial ||
    warnings.some(
      (warning) =>
        warning.includes(`truncated ${label}`) ||
        (label === 'architecture layers' &&
          warning.includes('entities unavailable for layer membership')),
    )
    ? 'partial'
    : 'available';
}

function evidenceIds(
  evidence: readonly ImpactEvidence[],
  reasons: readonly ImpactEvidence['reason'][],
): string[] {
  const reasonSet = new Set(reasons);
  return evidence.filter((item) => reasonSet.has(item.reason)).map((item) => item.id);
}

function countNormalization(raw: number): number {
  // Saturating count normalization: n / (n + 1), independent of repository size.
  return raw <= 0 ? 0 : raw / (raw + 1);
}

function probabilityNormalization(values: readonly number[]): number {
  // Independent exposure accumulation: 1 - product(1 - bounded factor).
  return 1 - values.reduce((remaining, value) => remaining * (1 - clamp(value)), 1);
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function canonicalValueKey(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalValueKey).join(',')}]`;
  if (typeof value !== 'object') return JSON.stringify(value) ?? String(value);
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort(compareIds)
    .map((key) => `${JSON.stringify(key)}:${canonicalValueKey(record[key])}`)
    .join(',')}}`;
}

function normalizePath(value: string): string {
  return value.replace(/\\/gu, '/').replace(/^\.\//u, '').replace(/\/+$/u, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
