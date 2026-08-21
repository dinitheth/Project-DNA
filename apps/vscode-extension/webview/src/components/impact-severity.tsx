import { ProgressBar } from './ui';

export type ImpactSeverity = 'Low' | 'Medium' | 'High' | 'Critical';

export function impactSeverity(score: number): ImpactSeverity {
  if (score >= 75) return 'Critical';
  if (score >= 50) return 'High';
  if (score >= 25) return 'Medium';
  return 'Low';
}

export function severityClass(score: number): string {
  if (score >= 75) return 'bg-[var(--vscode-editorError-foreground)]';
  if (score >= 50) return 'bg-[var(--vscode-charts-orange,#f59e0b)]';
  if (score >= 25) return 'bg-[var(--vscode-editorWarning-foreground)]';
  return 'bg-[var(--vscode-testing-iconPassed)]';
}

export function ImpactSeverityIndicator({
  score,
  label = 'Impact severity',
  compact = false,
}: {
  score: number;
  label?: string;
  compact?: boolean;
}) {
  const severity = impactSeverity(score);
  if (compact) {
    return (
      <div className="w-24 shrink-0">
        <span className="text-xs font-medium">{severity}</span>
        <div
          aria-label={`${label}: ${severity}, ${Math.round(score)} out of 100`}
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={score}
          className="mt-1 h-1.5 overflow-hidden rounded bg-dna-surface-hover"
          role="progressbar"
        >
          <div
            className={`h-full ${severityClass(score)}`}
            style={{ width: `${Math.min(100, Math.max(0, score))}%` }}
          />
        </div>
      </div>
    );
  }
  return (
    <div className="min-w-24 shrink-0">
      <span className="text-xs font-medium">{severity}</span>
      <ProgressBar
        fillClassName={severityClass(score)}
        label={`${label}: ${severity}`}
        trackClassName="bg-dna-surface-hover"
        value={score}
      />
    </div>
  );
}
