import type { ArchitectureData } from '@project-dna/shared';
import { Badge, EmptyCollection, MetricCard, ProgressBar, Section } from '../components/ui';

export function ArchitectureView({ data }: { data: ArchitectureData | null }) {
  if (!data) return <EmptyCollection>Architecture intelligence is not available.</EmptyCollection>;

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

      <Section title="Heuristic pattern signals">
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
      </Section>

      <Section title="Layers">
        {data.layers.length === 0 ? (
          <EmptyCollection>No explicit architecture layers were detected.</EmptyCollection>
        ) : (
          <div className="space-y-2">
            {data.layers.map((layer) => (
              <div
                key={`${layer.name}-${layer.role}`}
                className="rounded border border-panel-border bg-panel p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{formatLabel(layer.name)}</span>
                  <Badge>{layer.role}</Badge>
                </div>
                <div className="mt-2 text-xs text-description">
                  {layer.fileCount} files ·{' '}
                  {layer.directories.join(', ') || 'No mapped directories'}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Detection evidence">
        {data.evidence.length === 0 ? (
          <EmptyCollection>No detailed evidence is available.</EmptyCollection>
        ) : (
          <div className="space-y-2">
            {data.evidence.slice(0, 12).map((evidence, index) => (
              <div
                key={`${evidence.rule}-${index}`}
                className="rounded border border-panel-border p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{formatLabel(evidence.rule)}</span>
                  <span className="text-xs text-description">
                    Rule weight {Math.round(evidence.weight * 100)}%
                  </span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-description">
                  {evidence.description}
                </p>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function formatLabel(value: string): string {
  return value.replaceAll('-', ' ').replace(/\b\w/gu, (character) => character.toUpperCase());
}
