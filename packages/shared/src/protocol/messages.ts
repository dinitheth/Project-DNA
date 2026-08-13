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
      !/^[a-z]:[\\/]/iu.test(value) &&
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
]);

export type WebviewMessage = z.infer<typeof WebviewMessageSchema>;

/** Optional envelope for request/response correlation. */
export interface MessageEnvelope<T = ExtensionMessage | WebviewMessage> {
  readonly correlationId: string;
  readonly payload: T;
  readonly timestamp: string;
}
