import { useId, type ReactNode } from 'react';
import { cn } from '../utils/cn.js';

export interface SectionHeaderProps {
  title: string;
  action?: ReactNode;
  onAction?: () => void;
  actionLabel?: string;
  className?: string;
}

export function SectionHeader({
  title,
  action,
  onAction,
  actionLabel,
  className,
}: SectionHeaderProps) {
  const headingId = useId();
  return (
    <div
      aria-labelledby={headingId}
      className={cn('flex items-center justify-between gap-3', className)}
    >
      <h3 className="text-xs font-semibold uppercase tracking-wide" id={headingId}>
        {title}
      </h3>
      {action ? (
        onAction ? (
          <button aria-label={actionLabel} onClick={onAction} type="button">
            {action}
          </button>
        ) : (
          action
        )
      ) : null}
    </div>
  );
}
