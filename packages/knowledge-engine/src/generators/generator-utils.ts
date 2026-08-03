import { createHash } from 'node:crypto';
import { KnowledgeNodeSchema, RiskNodeSchema } from '@project-dna/dna-core';
import type {
  KnowledgeNode,
  KnowledgeNodeType,
  RiskNode,
  RiskSeverity,
  RiskType,
} from '@project-dna/dna-core';

export function stableId(kind: string, ...parts: Array<string | number>): string {
  return createHash('sha256')
    .update([kind, ...parts].join(':'))
    .digest('hex');
}

export function normalizePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+/g, '/');
}

export function knowledgeNode(input: {
  type: KnowledgeNodeType;
  name: string;
  metadata: Record<string, unknown>;
  tags: string[];
  createdAt: number;
  sourceRef?: string;
}): KnowledgeNode {
  return KnowledgeNodeSchema.parse({
    id: stableId('knowledge', input.type, input.name, input.sourceRef ?? 'repository'),
    type: input.type,
    name: input.name,
    metadata: input.metadata,
    relationships: [],
    tags: [...input.tags].sort(),
    sourceRef: input.sourceRef,
    createdAt: input.createdAt,
  });
}

export function riskNode(input: {
  type: RiskType;
  severity: RiskSeverity;
  affectedEntities: string[];
  description: string;
  detectedAt: number;
  measuredValue?: number;
  threshold?: number;
  suggestion?: string;
}): RiskNode {
  const affectedEntities = [...input.affectedEntities].sort();
  return RiskNodeSchema.parse({
    id: stableId('risk', input.type, ...affectedEntities),
    ...input,
    affectedEntities,
  });
}
