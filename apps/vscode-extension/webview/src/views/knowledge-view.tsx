import type { KnowledgeData } from '@project-dna/shared';
import { Badge, EmptyCollection, MetricCard, Section } from '../components/ui';

export function KnowledgeView({ data }: { data: KnowledgeData | null }) {
  if (!data) return <EmptyCollection>Knowledge intelligence is not available.</EmptyCollection>;

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
              <div
                key={`${node.type}-${node.name}-${index}`}
                className="rounded border border-panel-border p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{node.name}</span>
                  <Badge>{node.type}</Badge>
                </div>
                {node.sourceRef ? (
                  <div className="mt-1 truncate text-xs text-description">{node.sourceRef}</div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
