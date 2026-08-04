import type { DependencyData } from '@project-dna/shared';
import { Badge, EmptyCollection, MetricCard, Section } from '../components/ui';

export function DependenciesView({ data }: { data: DependencyData | null }) {
  if (!data) return <EmptyCollection>Dependency intelligence is not available.</EmptyCollection>;

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

      <Section title="Dependency kinds">
        <div className="flex flex-wrap gap-2">
          <Badge>{data.edgeTypes.imports} imports</Badge>
          <Badge>{data.edgeTypes.typeImports} type imports</Badge>
          <Badge>{data.edgeTypes.reExports} re-exports</Badge>
          <Badge>{data.edgeTypes.dynamicImports} dynamic imports</Badge>
          <Badge>{data.edgeTypes.requires} requires</Badge>
        </div>
      </Section>

      <Section title="Connection hotspots">
        {data.hotspots.length === 0 ? (
          <EmptyCollection>No dependency connections were detected.</EmptyCollection>
        ) : (
          <div className="space-y-2">
            {data.hotspots.map((hotspot) => (
              <div key={hotspot.id} className="rounded border border-panel-border bg-panel p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{hotspot.label}</div>
                    <div className="truncate text-xs text-description">
                      {hotspot.path ?? hotspot.id}
                    </div>
                  </div>
                  <Badge>{hotspot.kind}</Badge>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
                  <div>
                    <strong>{hotspot.dependents}</strong>
                    <br />
                    <span className="text-description">dependents</span>
                  </div>
                  <div>
                    <strong>{hotspot.dependencies}</strong>
                    <br />
                    <span className="text-description">dependencies</span>
                  </div>
                  <div>
                    <strong>{hotspot.totalConnections}</strong>
                    <br />
                    <span className="text-description">total</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
