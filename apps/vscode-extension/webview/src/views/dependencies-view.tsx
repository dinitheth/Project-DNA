import type { DependencyData, WorkspaceRelativePath } from '@project-dna/shared';
import { Badge, Panel, TreeView, type TreeItem } from '@project-dna/ui-components';
import { EmptyCollection, MetricCard } from '../components/ui';

export function DependenciesView({
  data,
  onOpenWorkspaceTarget,
}: {
  data: DependencyData | null;
  onOpenWorkspaceTarget: (path: WorkspaceRelativePath) => void;
}) {
  if (!data) return <EmptyCollection>Dependency intelligence is not available.</EmptyCollection>;

  const hotspotItems: TreeItem[] = data.hotspots.map((hotspot, index) => ({
    id: `hotspot:${index}:${hotspot.id}`,
    label: hotspot.label,
    description: hotspot.path ?? hotspot.id,
    children: [
      {
        id: `hotspot:${index}:dependents`,
        label: `${hotspot.dependents} dependents`,
        description: 'Incoming structural relationships',
      },
      {
        id: `hotspot:${index}:dependencies`,
        label: `${hotspot.dependencies} dependencies`,
        description: 'Outgoing structural relationships',
      },
      {
        id: `hotspot:${index}:total`,
        label: `${hotspot.totalConnections} total connections`,
        description: hotspot.kind,
      },
    ],
  }));
  const pathsByItemId = new Map<string, WorkspaceRelativePath>();
  data.hotspots.forEach((hotspot, index) => {
    if (hotspot.path) pathsByItemId.set(`hotspot:${index}:${hotspot.id}`, hotspot.path);
  });

  return (
    <div className="pb-4">
      <h2 className="text-xl font-bold">Dependencies</h2>
      <p className="mt-1 text-sm text-description">
        Live structural relationships extracted from repository imports.
      </p>

      <div className="my-5 grid grid-cols-2 gap-2">
        <MetricCard label="Graph nodes" value={data.nodeCount.toLocaleString()} />
        <MetricCard label="Graph edges" value={data.edgeCount.toLocaleString()} />
        <MetricCard label="Source files" value={data.nodeKinds.files.toLocaleString()} />
        <MetricCard label="External packages" value={data.nodeKinds.external.toLocaleString()} />
      </div>

      <div className="space-y-3">
        <Panel collapsible title="Dependency kinds">
          <div className="flex flex-wrap gap-2">
            <Badge variant="info">{data.edgeTypes.imports} imports</Badge>
            <Badge variant="neutral">{data.edgeTypes.typeImports} type imports</Badge>
            <Badge variant="neutral">{data.edgeTypes.reExports} re-exports</Badge>
            <Badge variant="warning">{data.edgeTypes.dynamicImports} dynamic imports</Badge>
            <Badge variant="neutral">{data.edgeTypes.requires} requires</Badge>
          </div>
        </Panel>

        <Panel collapsible title="Connection hotspots">
          {hotspotItems.length === 0 ? (
            <EmptyCollection>No dependency connections were detected.</EmptyCollection>
          ) : (
            <TreeView
              ariaLabel="Dependency connection hotspots"
              defaultExpandedIds={hotspotItems.map(({ id }) => id)}
              items={hotspotItems}
              onSelect={(item) => {
                const path = pathsByItemId.get(item.id);
                if (path) onOpenWorkspaceTarget(path);
              }}
            />
          )}
        </Panel>
      </div>
    </div>
  );
}
