/**
 * Typed message protocol for webview and extension-host communication.
 *
 * All messages cross a trust boundary and are validated at runtime. The data
 * contracts intentionally contain presentation-ready primitives rather than
 * domain objects so UI consumers remain independent from analysis internals.
 */

import { z } from 'zod';

export const SidebarRouteSchema = z.enum([
  'overview',
  'architecture',
  'knowledge',
  'dependencies',
  'settings',
]);

export type SidebarRoute = z.infer<typeof SidebarRouteSchema>;

const SafeNonnegativeIntegerSchema = z.number().int().nonnegative().safe();

export const WorkspaceRelativePathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => !value.includes('\0'), 'Workspace path cannot contain NUL bytes.')
  .refine(
    (value) =>
      !value.startsWith('/') &&
      !value.startsWith('\\') &&
      !/^[a-z]:/iu.test(value) &&
      !value.replaceAll('\\', '/').split('/').includes('..'),
    'Expected a workspace-relative path without parent traversal.',
  );

export type WorkspaceRelativePath = z.infer<typeof WorkspaceRelativePathSchema>;

const EntityDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.string(),
  path: WorkspaceRelativePathSchema,
  purpose: z.string(),
  role: z.string(),
  domain: z.string().nullable(),
  criticality: z.string(),
  complexity: z.number().nonnegative(),
  health: z.number().min(0).max(1),
  dependencies: z.array(z.string()).max(100),
  dependents: z.array(z.string()).max(100),
  risks: z.array(z.string()).max(100),
  knowledgeReferences: z.array(z.string()).max(100),
});

export const EntityDetailDataSchema = EntityDetailSchema;
export type EntityDetailData = z.infer<typeof EntityDetailDataSchema>;

export const EvolutionComparisonDataSchema = z.object({
  fromVersion: SafeNonnegativeIntegerSchema,
  toVersion: SafeNonnegativeIntegerSchema,
  addedEntities: z.array(z.string()).max(100),
  removedEntities: z.array(z.string()).max(100),
  changedEntities: z
    .array(z.object({ entityId: z.string(), fields: z.array(z.string()).max(50) }))
    .max(100),
  healthDelta: z.object({ overall: z.number(), dimensions: z.record(z.string(), z.number()) }),
  newRisks: z.array(z.string()).max(100),
  resolvedRisks: z.array(z.string()).max(100),
  addedEdges: z.number().int().nonnegative(),
  removedEdges: z.number().int().nonnegative(),
  newDomains: z.array(z.string()).max(100),
  removedDomains: z.array(z.string()).max(100),
  architecturalSignificance: z.number().min(0).max(1),
});
export type EvolutionComparisonData = z.infer<typeof EvolutionComparisonDataSchema>;

const HealthDimensionsSchema = z.object({
  architectureHealth: z.number().min(0).max(100),
  dependencyHealth: z.number().min(0).max(100),
  complexityHealth: z.number().min(0).max(100),
  knowledgeHealth: z.number().min(0).max(100),
  riskHealth: z.number().min(0).max(100),
});

const RiskSeverityCountsSchema = z.object({
  critical: z.number().int().nonnegative(),
  high: z.number().int().nonnegative(),
  medium: z.number().int().nonnegative(),
  low: z.number().int().nonnegative(),
  info: z.number().int().nonnegative(),
});

export const RepositoryDataSchema = z.object({
  name: z.string(),
  description: z.string(),
  rootPath: z.string(),
  version: z.number().int().nonnegative(),
  analyzedAt: z.number(),
  durationMs: z.number().nonnegative(),
  projectType: z.string(),
  repositorySize: z.string(),
  packageManager: z.string().nullable(),
  testFramework: z.string().nullable(),
  ciSystem: z.string().nullable(),
  languages: z.array(
    z.object({
      language: z.string(),
      percentage: z.number().min(0).max(100),
      fileCount: z.number().int().nonnegative(),
      linesOfCode: z.number().int().nonnegative(),
    }),
  ),
  frameworks: z.array(
    z.object({
      name: z.string(),
      version: z.string().nullable(),
      category: z.string(),
      confidence: z.number().min(0).max(1),
    }),
  ),
  counts: z.object({
    modules: z.number().int().nonnegative(),
    entities: z.number().int().nonnegative(),
    domains: z.number().int().nonnegative(),
    capabilities: z.number().int().nonnegative(),
    knowledgeNodes: z.number().int().nonnegative(),
    risks: z.number().int().nonnegative(),
  }),
  coverage: z.object({
    scanned: z.number().int().nonnegative(),
    parsed: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
  }),
  health: z.object({
    overallScore: z.number().min(0).max(100),
    trend: z.string(),
    dimensions: HealthDimensionsSchema,
  }),
  complexity: z.object({
    averageComplexity: z.number().nonnegative(),
    maxComplexity: z.number().nonnegative(),
    mostComplexFile: z.string().nullable(),
    complexCodePercentage: z.number().min(0).max(100),
    averageNestingDepth: z.number().nonnegative(),
    maxNestingDepth: z.number().int().nonnegative(),
  }),
  risks: z.object({
    overallRiskScore: z.number().min(0).max(100),
    totalRisks: z.number().int().nonnegative(),
    bySeverity: RiskSeverityCountsSchema,
    topRisks: z.array(
      z.object({
        type: z.string(),
        severity: z.string(),
        description: z.string(),
        affectedEntityCount: z.number().int().nonnegative(),
      }),
    ),
  }),
  criticalComponents: z.array(
    z.object({
      name: z.string(),
      path: z.string(),
      criticality: z.string(),
      score: z.number().min(0).max(1),
      reason: z.string(),
    }),
  ),
  story: z.object({
    summary: z.string(),
    healthSummary: z.string(),
    criticalPath: z.string(),
    risks: z.array(z.string()),
  }),
});

export type RepositoryData = z.infer<typeof RepositoryDataSchema>;

export const ArchitectureDataSchema = z.object({
  pattern: z.string(),
  confidence: z.number().min(0).max(1),
  detectedAt: z.number(),
  detectedPatterns: z.array(
    z.object({
      pattern: z.string(),
      confidence: z.number().min(0).max(1),
    }),
  ),
  layers: z.array(
    z.object({
      name: z.string(),
      role: z.string(),
      fileCount: z.number().int().nonnegative(),
      directories: z.array(z.string()),
    }),
  ),
  evidence: z.array(
    z.object({
      rule: z.string(),
      description: z.string(),
      matchedPaths: z.array(z.string()),
      weight: z.number().min(0).max(1),
    }),
  ),
  summary: z.string(),
});

export type ArchitectureData = z.infer<typeof ArchitectureDataSchema>;

export const DependencyDataSchema = z.object({
  nodeCount: z.number().int().nonnegative(),
  edgeCount: z.number().int().nonnegative(),
  nodeKinds: z.object({
    files: z.number().int().nonnegative(),
    modules: z.number().int().nonnegative(),
    packages: z.number().int().nonnegative(),
    external: z.number().int().nonnegative(),
  }),
  edgeTypes: z.object({
    imports: z.number().int().nonnegative(),
    reExports: z.number().int().nonnegative(),
    dynamicImports: z.number().int().nonnegative(),
    requires: z.number().int().nonnegative(),
    typeImports: z.number().int().nonnegative(),
  }),
  hotspots: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      path: z.string().nullable(),
      kind: z.string(),
      dependencies: z.number().int().nonnegative(),
      dependents: z.number().int().nonnegative(),
      totalConnections: z.number().int().nonnegative(),
    }),
  ),
});

export type DependencyData = z.infer<typeof DependencyDataSchema>;

export const KnowledgeDataSchema = z.object({
  domains: z.array(
    z.object({
      name: z.string(),
      confidence: z.number().min(0).max(1),
      fileCount: z.number().int().nonnegative(),
      linesOfCode: z.number().int().nonnegative(),
      primaryLanguages: z.array(z.string()),
      rootPaths: z.array(z.string()),
    }),
  ),
  capabilities: z.array(
    z.object({
      name: z.string(),
      category: z.string(),
      description: z.string(),
      confidence: z.number().min(0).max(1),
      implementationCount: z.number().int().nonnegative(),
    }),
  ),
  nodes: z.array(
    z.object({
      name: z.string(),
      type: z.string(),
      sourceRef: z.string().nullable(),
      tags: z.array(z.string()),
      relationshipCount: z.number().int().nonnegative(),
    }),
  ),
});

export type KnowledgeData = z.infer<typeof KnowledgeDataSchema>;

const SemanticGraphNodeKindSchema = z.enum([
  'module',
  'domain',
  'layer',
  'concept',
  'capability',
  'component',
  'risk',
  'entity',
]);

const SemanticGraphEdgeKindSchema = z.enum([
  'contains',
  'serves',
  'depends-on',
  'implements',
  'risks',
  'constrains',
  'belongs-to',
  'evolves-from',
]);

export const SemanticGraphDataSchema = z.object({
  nodeCount: z.number().int().nonnegative(),
  edgeCount: z.number().int().nonnegative(),
  nodes: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      kind: SemanticGraphNodeKindSchema,
      weight: z.number().min(0).max(1),
      incomingRelationshipCount: z.number().int().nonnegative(),
      outgoingRelationshipCount: z.number().int().nonnegative(),
    }),
  ),
  edges: z.array(
    z.object({
      source: z.string(),
      target: z.string(),
      kind: SemanticGraphEdgeKindSchema,
      weight: z.number().min(0).max(1),
      confidence: z.number().min(0).max(1),
    }),
  ),
  truncated: z.boolean(),
});

export type SemanticGraphData = z.infer<typeof SemanticGraphDataSchema>;

const EvolutionSnapshotDataSchema = z.object({
  id: z.string(),
  version: z.number().int().nonnegative(),
  timestamp: z.number(),
  trigger: z.enum(['manual', 'incremental', 'scheduled', 'architectural-change']),
  projectDnaHash: z.string(),
  gitCommitHash: z.string().nullable(),
  metrics: z.record(z.string(), z.number()),
  isFullSnapshot: z.boolean(),
});

export const EvolutionDataSchema = z.object({
  latestSnapshot: EvolutionSnapshotDataSchema.nullable(),
  history: z.array(EvolutionSnapshotDataSchema),
});

export type EvolutionData = z.infer<typeof EvolutionDataSchema>;

export const ImpactTargetDataSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('file'), path: WorkspaceRelativePathSchema }),
  z.object({ kind: z.literal('entity'), id: z.string().min(1).max(512) }),
]);
export type ImpactTargetData = z.infer<typeof ImpactTargetDataSchema>;

const ImpactRelationshipSchema = z.object({
  dependentId: z.string().min(1),
  dependencyId: z.string().min(1),
  type: z.enum(['import', 're-export', 'dynamic-import', 'require', 'type-import']),
  isTypeOnly: z.boolean(),
  specifierCount: z.number().int().nonnegative(),
});
const ImpactNodeSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('file'),
  name: z.string().min(1),
  path: WorkspaceRelativePathSchema.nullable(),
  minimumDepth: z.number().int().nonnegative(),
});
const ImpactPathSchema = z.object({
  impactedEntityId: z.string().min(1),
  nodeIds: z.array(z.string().min(1)).min(2).max(33),
  relationships: z.array(ImpactRelationshipSchema).max(32),
});
const ImpactEvidenceSchema = z.object({
  id: z.string().min(1),
  entityId: z.string().min(1),
  reason: z.enum([
    'direct-dependent',
    'transitive-dependent',
    'domain-membership',
    'capability-implementation',
    'critical-component',
    'risk-reference',
    'architecture-layer-membership',
    'layer-boundary',
  ]),
  path: ImpactPathSchema.nullable(),
  sourcePath: WorkspaceRelativePathSchema.nullable(),
  confidence: z.number().min(0).max(1),
});
const ImpactDomainSchema = z.object({
  id: z.string(),
  name: z.string(),
  confidence: z.number().min(0).max(1),
  entityCount: z.number().int().nonnegative(),
});
const ImpactCapabilitySchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.enum([
    'api',
    'authentication',
    'authorization',
    'caching',
    'database',
    'file-system',
    'logging',
    'messaging',
    'monitoring',
    'networking',
    'scheduling',
    'search',
    'storage',
    'testing',
    'ui',
    'other',
  ]),
  description: z.string(),
  confidence: z.number().min(0).max(1),
  implementationCount: z.number().int().nonnegative(),
});
const ImpactCriticalComponentSchema = z.object({
  id: z.string(),
  entityId: z.string(),
  name: z.string(),
  path: WorkspaceRelativePathSchema,
  criticality: z.enum(['critical', 'high', 'medium', 'low']),
  score: z.number().min(0).max(1),
  reason: z.string(),
});
const ImpactRiskSchema = z.object({
  id: z.string(),
  type: z.enum([
    'circular-dependency',
    'god-class',
    'high-complexity',
    'orphan-file',
    'unstable-module',
    'large-file',
    'deep-nesting',
    'excessive-imports',
    'missing-types',
    'barrel-explosion',
  ]),
  severity: z.enum(['info', 'low', 'medium', 'high', 'critical']),
  affectedEntityCount: z.number().int().nonnegative(),
  description: z.string(),
  measuredValue: z.number().optional(),
  threshold: z.number().optional(),
  suggestion: z.string().optional(),
});
const ImpactLayerSchema = z.object({
  name: z.string(),
  fileCount: z.number().int().nonnegative(),
  role: z.enum([
    'presentation',
    'application',
    'domain',
    'infrastructure',
    'shared',
    'config',
    'test',
    'unknown',
  ]),
});
const ImpactScoreComponentSchema = z.object({
  kind: z.enum([
    'dependency-reach',
    'critical-component-exposure',
    'domain-reach',
    'risk-exposure',
    'architecture-boundaries',
  ]),
  rawInput: z.number().nonnegative(),
  normalizedValue: z.number().min(0).max(1),
  weight: z.number().min(0).max(1),
  contribution: z.number().min(0).max(100),
  evidenceIds: z.array(z.string()).max(30000),
  status: z.enum(['available', 'partial', 'unavailable']),
});
export const ImpactResultDataSchema = z.object({
  repositoryId: z.string().min(1),
  analysisVersion: z.number().int().nonnegative(),
  target: ImpactNodeSchema,
  directImpactedEntities: z.array(ImpactNodeSchema).max(5000),
  transitiveImpactedEntities: z.array(ImpactNodeSchema).max(5000),
  minimumDepth: z.number().int().nonnegative().nullable(),
  canonicalPaths: z.array(ImpactPathSchema).max(3),
  semanticEffects: z.object({
    domains: z.array(ImpactDomainSchema).max(5000),
    capabilities: z.array(ImpactCapabilitySchema).max(5000),
    criticalComponents: z.array(ImpactCriticalComponentSchema).max(5000),
    risks: z.array(ImpactRiskSchema).max(5000),
    architecture: z.object({
      layers: z.array(ImpactLayerSchema).max(5000),
      boundaryCrossings: z
        .array(
          z.object({
            fromLayer: z.string(),
            toLayer: z.string(),
            dependentId: z.string(),
            dependencyId: z.string(),
          }),
        )
        .max(5000),
    }),
  }),
  score: z.object({
    total: z.number().min(0).max(100),
    components: z.array(ImpactScoreComponentSchema).length(5),
  }),
  evidence: z.array(ImpactEvidenceSchema).max(30000),
  warnings: z.array(z.string().max(1000)).max(100),
  complete: z.boolean(),
  truncations: z
    .array(
      z.object({
        kind: z.enum(['max-depth', 'max-entities', 'max-evidence-paths']),
        limit: z.number().int().nonnegative(),
        atEntityId: z.string().nullable(),
      }),
    )
    .max(100),
  appliedBounds: z.object({
    maxDepth: z.number().int().nonnegative(),
    maxEntities: z.number().int().positive(),
    maxEvidencePaths: z.number().int().positive(),
  }),
});
export type ImpactResultData = z.infer<typeof ImpactResultDataSchema>;

const WorkingTreeChangeKindDataSchema = z.enum([
  'added',
  'modified',
  'deleted',
  'renamed',
  'type-changed',
]);
const WorkingTreeContentKindDataSchema = z.enum([
  'text',
  'binary',
  'symlink',
  'submodule',
  'unknown',
]);

export const WorkingTreeChangedPathDataSchema = z.object({
  kind: WorkingTreeChangeKindDataSchema,
  path: WorkspaceRelativePathSchema,
  previousPath: WorkspaceRelativePathSchema.optional(),
  staged: z.boolean(),
  unstaged: z.boolean(),
  untracked: z.boolean(),
  contentKind: WorkingTreeContentKindDataSchema,
});
export type WorkingTreeChangedPathData = z.infer<typeof WorkingTreeChangedPathDataSchema>;

export const WorkingTreeResolvedTargetDataSchema = z.object({
  path: WorkspaceRelativePathSchema,
  previousPath: WorkspaceRelativePathSchema.optional(),
  side: z.enum(['before', 'after']),
  entityId: z.string().min(1).max(512),
  sourceAvailable: z.boolean(),
});
export type WorkingTreeResolvedTargetData = z.infer<typeof WorkingTreeResolvedTargetDataSchema>;

export const WorkingTreeUnresolvedPathDataSchema = z.object({
  path: WorkspaceRelativePathSchema,
  previousPath: WorkspaceRelativePathSchema.optional(),
  side: z.enum(['before', 'after']),
  reason: z.enum([
    'analysis-refresh-required',
    'clean-baseline-unavailable',
    'legacy-analysis-state-unavailable',
    'non-analyzable',
    'missing-entity',
  ]),
});
export type WorkingTreeUnresolvedPathData = z.infer<typeof WorkingTreeUnresolvedPathDataSchema>;

export const WorkingTreeImpactEntryDataSchema = z.object({
  path: WorkspaceRelativePathSchema,
  side: z.enum(['before', 'after']),
  result: ImpactResultDataSchema,
});
export type WorkingTreeImpactEntryData = z.infer<typeof WorkingTreeImpactEntryDataSchema>;

export const WorkingTreeImpactDataSchema = z
  .object({
    repositoryId: z.string().min(1).max(512),
    headCommit: z.string().regex(/^[0-9a-f]{4,}$/u),
    changedPaths: z.array(WorkingTreeChangedPathDataSchema).max(500),
    resolvedTargets: z.array(WorkingTreeResolvedTargetDataSchema).max(500),
    unresolvedPaths: z.array(WorkingTreeUnresolvedPathDataSchema).max(500),
    impacts: z.array(WorkingTreeImpactEntryDataSchema).max(500),
    changedEntityIds: z.array(z.string().min(1).max(512)).max(5000),
    impactedEntityIds: z.array(z.string().min(1).max(512)).max(5000),
    beforeAnalysisVersion: SafeNonnegativeIntegerSchema.nullable(),
    afterAnalysisVersion: SafeNonnegativeIntegerSchema.nullable(),
    warnings: z.array(z.string().max(1000)).max(100),
    complete: z.boolean(),
    truncations: z
      .array(
        z.object({
          kind: z.enum(['max-changed-paths', 'max-targets', 'max-impacted-entities']),
          limit: z.number().int().positive(),
        }),
      )
      .max(100),
  })
  .strict();
export type WorkingTreeImpactData = z.infer<typeof WorkingTreeImpactDataSchema>;

export const ExtensionMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('analysisUnavailable'),
    rootPath: z.string().nullable(),
  }),
  z.object({
    type: z.literal('analysisStarted'),
    rootPath: z.string(),
  }),
  z.object({
    type: z.literal('analysisProgress'),
    stage: z.string(),
    message: z.string(),
    percent: z.number().min(0).max(100),
  }),
  z.object({
    type: z.literal('analysisComplete'),
    version: z.number().int().nonnegative().optional(),
    summary: z.object({
      fileCount: z.number(),
      languageCount: z.number(),
      architecturePattern: z.string(),
      knowledgeNodeCount: z.number(),
      durationMs: z.number(),
    }),
  }),
  z.object({
    type: z.literal('analysisError'),
    message: z.string(),
    stage: z.string().optional(),
  }),
  z.object({
    type: z.literal('repositoryData'),
    data: RepositoryDataSchema,
  }),
  z.object({
    type: z.literal('architectureData'),
    data: ArchitectureDataSchema,
  }),
  z.object({
    type: z.literal('dependencyData'),
    data: DependencyDataSchema,
  }),
  z.object({
    type: z.literal('knowledgeData'),
    data: KnowledgeDataSchema,
  }),
  z.object({
    type: z.literal('analysisSnapshot'),
    version: z.number().int().nonnegative(),
    data: z.object({
      repository: RepositoryDataSchema,
      architecture: ArchitectureDataSchema,
      dependencies: DependencyDataSchema,
      knowledge: KnowledgeDataSchema,
      semanticGraph: SemanticGraphDataSchema,
      evolution: EvolutionDataSchema,
    }),
  }),
  z.object({
    type: z.literal('themeChanged'),
    kind: z.enum(['light', 'dark', 'high-contrast']),
  }),
  z.object({
    type: z.literal('navigateTo'),
    route: SidebarRouteSchema,
    generation: SafeNonnegativeIntegerSchema,
    revision: SafeNonnegativeIntegerSchema,
    requestId: SafeNonnegativeIntegerSchema.optional(),
  }),
  z.object({
    type: z.literal('workspaceTargetResult'),
    requestId: SafeNonnegativeIntegerSchema,
    path: WorkspaceRelativePathSchema,
    outcome: z.enum(['opened', 'missing', 'rejected', 'failed']),
    message: z.string().optional(),
  }),
  z.object({
    type: z.literal('entityDetail'),
    requestId: SafeNonnegativeIntegerSchema,
    analysisVersion: SafeNonnegativeIntegerSchema,
    entityId: z.string(),
    entity: EntityDetailSchema.nullable(),
    error: z.string().optional(),
  }),
  z.object({
    type: z.literal('evolutionComparison'),
    requestId: SafeNonnegativeIntegerSchema,
    analysisVersion: SafeNonnegativeIntegerSchema,
    fromVersion: SafeNonnegativeIntegerSchema,
    toVersion: SafeNonnegativeIntegerSchema,
    comparison: EvolutionComparisonDataSchema.nullable(),
    error: z.string().optional(),
  }),
  z.object({
    type: z.literal('impactResult'),
    requestId: SafeNonnegativeIntegerSchema,
    analysisVersion: SafeNonnegativeIntegerSchema,
    target: ImpactTargetDataSchema,
    result: ImpactResultDataSchema.nullable(),
    error: z.string().optional(),
  }),
  z.object({
    type: z.literal('workingTreeImpactResult'),
    requestId: SafeNonnegativeIntegerSchema,
    analysisVersion: SafeNonnegativeIntegerSchema,
    result: WorkingTreeImpactDataSchema.nullable(),
    error: z.string().optional(),
  }),
]);

export type ExtensionMessage = z.infer<typeof ExtensionMessageSchema>;

export const WebviewMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('requestAnalysis') }),
  z.object({ type: z.literal('requestRefresh') }),
  z.object({ type: z.literal('requestRepositoryData') }),
  z.object({ type: z.literal('requestArchitectureData') }),
  z.object({ type: z.literal('requestDependencyData') }),
  z.object({ type: z.literal('requestKnowledgeData') }),
  z.object({
    type: z.literal('navigateTo'),
    route: SidebarRouteSchema,
    generation: SafeNonnegativeIntegerSchema,
    revision: SafeNonnegativeIntegerSchema,
    requestId: SafeNonnegativeIntegerSchema,
  }),
  z.object({
    type: z.literal('updateSettings'),
    settings: z.record(z.unknown()),
  }),
  z.object({
    type: z.literal('ready'),
    route: SidebarRouteSchema,
    generation: SafeNonnegativeIntegerSchema,
    revision: SafeNonnegativeIntegerSchema,
  }),
  z.object({
    type: z.literal('openWorkspaceTarget'),
    requestId: SafeNonnegativeIntegerSchema,
    path: WorkspaceRelativePathSchema,
  }),
  z.object({
    type: z.literal('requestEntityDetail'),
    requestId: SafeNonnegativeIntegerSchema,
    analysisVersion: SafeNonnegativeIntegerSchema,
    entityId: z.string().min(1),
  }),
  z.object({
    type: z.literal('requestEvolutionComparison'),
    requestId: SafeNonnegativeIntegerSchema,
    analysisVersion: SafeNonnegativeIntegerSchema,
    fromVersion: SafeNonnegativeIntegerSchema,
    toVersion: SafeNonnegativeIntegerSchema,
  }),
  z.object({
    type: z.literal('requestImpact'),
    requestId: SafeNonnegativeIntegerSchema,
    analysisVersion: SafeNonnegativeIntegerSchema,
    target: ImpactTargetDataSchema,
  }),
  z.object({
    type: z.literal('cancelImpact'),
    requestId: SafeNonnegativeIntegerSchema,
  }),
  z.object({
    type: z.literal('requestWorkingTreeImpact'),
    requestId: SafeNonnegativeIntegerSchema,
    analysisVersion: SafeNonnegativeIntegerSchema,
  }),
  z.object({
    type: z.literal('cancelWorkingTreeImpact'),
    requestId: SafeNonnegativeIntegerSchema,
  }),
]);

export type WebviewMessage = z.infer<typeof WebviewMessageSchema>;

/** Optional envelope for request/response correlation. */
export interface MessageEnvelope<T = ExtensionMessage | WebviewMessage> {
  readonly correlationId: string;
  readonly payload: T;
  readonly timestamp: string;
}
