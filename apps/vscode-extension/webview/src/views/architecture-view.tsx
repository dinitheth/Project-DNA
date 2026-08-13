import type { ArchitectureData } from '@project-dna/shared';
import { Badge, Panel, TreeView, type TreeItem } from '@project-dna/ui-components';
import { EmptyCollection, MetricCard, ProgressBar } from '../components/ui';

export function ArchitectureView({ data }: { data: ArchitectureData | null }) {
  if (!data) return <EmptyCollection>Architecture intelligence is not available.</EmptyCollection>;

  const layerItems: TreeItem[] = data.layers.map((layer, layerIndex) => ({
    id: `layer:${layerIndex}:${layer.name}`,
    label: formatLabel(layer.name),
    description: `${formatLabel(layer.role)} · ${layer.fileCount} files`,
    children: layer.directories.map((directory, directoryIndex) => ({
      id: `layer:${layerIndex}:directory:${directoryIndex}`,
      label: directory,
      description: 'Mapped directory',
    })),
  }));

  const evidenceItems: TreeItem[] = data.evidence.slice(0, 12).map((evidence, index) => ({
    id: `evidence:${index}:${evidence.rule}`,
    label: formatLabel(evidence.rule),
    description: `${evidence.description} · weight ${Math.round(evidence.weight * 100)}%`,
    children: evidence.matchedPaths.map((matchedPath, pathIndex) => ({
      id: `evidence:${index}:path:${pathIndex}`,
      label: matchedPath,
      description: 'Matched path',
    })),
  }));

  return (
    <div className="pb-4">
      <h2 className="text-xl font-bold">Architecture</h2>
      <p className="mt-1 text-sm leading-relaxed text-description">{data.summary}</p>

      <div className="my-5 grid grid-cols-2 gap-2">
        <MetricCard label="Primary pattern" value={formatLabel(data.pattern)} />
        <MetricCard label="Heuristic match" value={`${Math.round(data.confidence * 100)}%`} />
        <MetricCard label="Layers" value={data.layers.length} />
        <MetricCard label="Evidence signals" value={data.evidence.length} />
      </div>

      <div className="space-y-3">
        <Panel collapsible title="Heuristic pattern signals">
          {data.detectedPatterns.length === 0 ? (
            <EmptyCollection>
              No architecture pattern reached the detection threshold.
            </EmptyCollection>
          ) : (
            data.detectedPatterns.map((pattern) => (
              <ProgressBar
                key={pattern.pattern}
                label={formatLabel(pattern.pattern)}
                value={pattern.confidence * 100}
              />
            ))
          )}
        </Panel>

        <Panel collapsible title="Layers">
          {layerItems.length === 0 ? (
            <EmptyCollection>No explicit architecture layers were detected.</EmptyCollection>
          ) : (
            <>
              <div className="mb-2 flex flex-wrap gap-1">
                {data.layers.map((layer, index) => (
                  <Badge key={`${layer.name}-${index}`} variant="info">
                    {formatLabel(layer.role)}
                  </Badge>
                ))}
              </div>
              <TreeView
                ariaLabel="Architecture layers"
                defaultExpandedIds={layerItems.map(({ id }) => id)}
                items={layerItems}
              />
            </>
          )}
        </Panel>

        <Panel collapsible defaultOpen={false} title="Detection evidence">
          {evidenceItems.length === 0 ? (
            <EmptyCollection>No detailed evidence is available.</EmptyCollection>
          ) : (
            <TreeView
              ariaLabel="Architecture detection evidence"
              defaultExpandedIds={evidenceItems.map(({ id }) => id)}
              items={evidenceItems}
            />
          )}
        </Panel>
      </div>
    </div>
  );
}

function formatLabel(value: string): string {
  return value.replaceAll('-', ' ').replace(/\b\w/gu, (character) => character.toUpperCase());
}
