import type { ReactNode } from 'react';

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-5">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-description">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function MetricCard({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded border border-panel-border bg-panel p-3">
      <div className="text-xl font-semibold leading-none">{value}</div>
      <div className="mt-2 text-xs text-description">{label}</div>
    </div>
  );
}

export function ProgressBar({ label, value }: { label: string; value: number }) {
  const boundedValue = Math.min(100, Math.max(0, Math.round(value)));
  return (
    <div className="mb-3">
      <div className="mb-1 flex justify-between gap-3 text-xs">
        <span>{label}</span>
        <span className="text-description">{boundedValue}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded bg-progress-background">
        <div className="h-full rounded bg-progress" style={{ width: `${boundedValue}%` }} />
      </div>
    </div>
  );
}

export function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="rounded bg-badge px-2 py-0.5 text-xs text-badge-foreground">{children}</span>
  );
}

export function EmptyCollection({ children }: { children: ReactNode }) {
  return (
    <div className="rounded border border-dashed border-panel-border p-3 text-sm text-description">
      {children}
    </div>
  );
}
