import type { ReactNode } from 'react';

export function Section({
  title,
  children,
  className = '',
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`mb-5 ${className}`}>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-description">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function MetricCard({
  label,
  value,
  className = 'border-panel-border bg-panel',
}: {
  label: string;
  value: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded border p-3 ${className}`}>
      <div className="text-xl font-semibold leading-none">{value}</div>
      <div className="mt-2 text-xs text-description">{label}</div>
    </div>
  );
}

export function ProgressBar({
  label,
  value,
  className = 'mb-3',
  trackClassName = 'bg-progress-background',
  fillClassName = 'bg-progress',
}: {
  label: string;
  value: number;
  className?: string;
  trackClassName?: string;
  fillClassName?: string;
}) {
  const boundedValue = Math.min(100, Math.max(0, Math.round(value)));
  return (
    <div className={className}>
      <div className="mb-1 flex justify-between gap-3 text-xs">
        <span>{label}</span>
        <span className="text-description">{boundedValue}%</span>
      </div>
      <div
        aria-label={`${label}: ${boundedValue}%`}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={boundedValue}
        className={`h-1.5 overflow-hidden rounded ${trackClassName}`}
        role="progressbar"
      >
        <div className={`h-full rounded ${fillClassName}`} style={{ width: `${boundedValue}%` }} />
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
