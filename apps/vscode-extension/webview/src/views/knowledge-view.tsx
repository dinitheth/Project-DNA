import type { KnowledgeData, SemanticGraphData, WorkspaceRelativePath } from '@project-dna/shared';
import { Badge, EmptyCollection, MetricCard, Section } from '../components/ui';
import { Panel, TreeView, type TreeItem } from '@project-dna/ui-components';

export function KnowledgeView({
  data,
  onOpenWorkspaceTarget,
  onSelectEntity,
  semanticGraph,
}: {
  data: KnowledgeData | null;
  onOpenWorkspaceTarget: (path: WorkspaceRelativePath) => void;
  onSelectEntity: (entityId: string) => void;
  semanticGraph: SemanticGraphData | null;
}) {
  if (!data) return <EmptyCollection>Knowledge intelligence is not available.</EmptyCollection>;

  const graphItems = buildGraphItems(semanticGraph);

  return (
    <div className="pb-4">
      <h2 className="text-xl font-bold">Knowledge</h2>
      <p className="mt-1 text-sm text-description">
        Deterministic domains, capabilities, and facts inferred from the codebase.
      </p>

      <div className="my-5 grid grid-cols-3 gap-2">
        <MetricCard label="Domains" value={data.domains.length} />
        <MetricCard label="Capabilities" value={data.capabilities.length} />
        <MetricCard label="Facts shown" value={data.nodes.length} />
      </div>

      <Section title="Business domains">
        {data.domains.length === 0 ? (
          <EmptyCollection>No business domains were inferred.</EmptyCollection>
        ) : (
          <div className="space-y-2">
            {data.domains.map((domain) => (
              <div key={domain.name} className="rounded border border-panel-border bg-panel p-3">
                <div className="flex justify-between gap-2">
                  <span className="font-medium">{domain.name}</span>
                  <span className="text-xs text-description">
                    Heuristic match {Math.round(domain.confidence * 100)}%
                  </span>
                </div>
                <div className="mt-1 text-xs text-description">
                  {domain.fileCount} files · {domain.linesOfCode.toLocaleString()} lines
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {domain.primaryLanguages.map((language) => (
                    <Badge key={language}>{language}</Badge>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Capabilities">
        {data.capabilities.length === 0 ? (
          <EmptyCollection>No functional capabilities were detected.</EmptyCollection>
        ) : (
          <div className="space-y-2">
            {data.capabilities.map((capability) => (
              <div
                key={`${capability.category}-${capability.name}`}
                className="rounded border border-panel-border p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{capability.name}</span>
                  <Badge>{capability.category}</Badge>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-description">
                  {capability.description}
                </p>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Knowledge facts">
        {data.nodes.length === 0 ? (
          <EmptyCollection>No knowledge nodes were generated.</EmptyCollection>
        ) : (
          <div className="space-y-2">
            {data.nodes.map((node, index) => (
              <button
                key={`${node.type}-${node.name}-${index}`}
                className="w-full rounded border border-panel-border p-3 text-left disabled:cursor-default"
                disabled={!node.sourceRef}
                onClick={() => {
                  if (node.sourceRef) onOpenWorkspaceTarget(node.sourceRef);
                }}
                type="button"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{node.name}</span>
                  <Badge>{node.type}</Badge>
                </div>
                {node.sourceRef ? (
                  <div className="mt-1 truncate text-xs text-description">{node.sourceRef}</div>
                ) : null}
              </button>
            ))}
          </div>
        )}
      </Section>

      <Panel collapsible title="Semantic knowledge graph">
        {!semanticGraph || graphItems.length === 0 ? (
          <EmptyCollection>No semantic relationships were generated.</EmptyCollection>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap gap-1">
              <Badge>{semanticGraph.nodeCount} nodes</Badge>
              <Badge>{semanticGraph.edgeCount} relationships</Badge>
              {semanticGraph.truncated ? <Badge>Preview limited</Badge> : null}
            </div>
            <TreeView
              ariaLabel="Semantic knowledge graph"
              defaultExpandedIds={graphItems.map(({ id }) => id)}
              items={graphItems}
              onSelect={(item) => {
                if (item.id.startsWith('graph:') && !item.id.includes(':edge:')) {
                  onSelectEntity(item.id.slice('graph:'.length));
                }
              }}
            />
          </>
        )}
      </Panel>
    </div>
  );
}

function buildGraphItems(graph: SemanticGraphData | null): TreeItem[] {
  if (!graph) return [];
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const edgesBySource = new Map<string, SemanticGraphData['edges']>();
  for (const edge of graph.edges) {
    const edges = edgesBySource.get(edge.source) ?? [];
    edges.push(edge);
    edgesBySource.set(edge.source, edges);
  }
  return [...graph.nodes]
    .sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id))
    .map((node) => ({
      id: `graph:${node.id}`,
      label: node.label,
      description: `${formatLabel(node.kind)} · ${node.incomingRelationshipCount} in · ${node.outgoingRelationshipCount} out`,
      children: (edgesBySource.get(node.id) ?? [])
        .sort(
          (left, right) =>
            left.kind.localeCompare(right.kind) || left.target.localeCompare(right.target),
        )
        .map((edge) => ({
          id: `graph:${node.id}:edge:${edge.target}:${edge.kind}`,
          label: `${formatLabel(edge.kind)} → ${nodesById.get(edge.target)?.label ?? edge.target}`,
          description: `confidence ${Math.round(edge.confidence * 100)}%`,
        })),
    }));
}

function formatLabel(value: string): string {
  return value.replaceAll('-', ' ').replace(/\b\w/gu, (character) => character.toUpperCase());
}
