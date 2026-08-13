import type { ReactNode } from 'react';
import { cn } from '../utils/cn.js';

export interface BadgeProps {
  label?: string;
  children?: ReactNode;
  variant?: 'info' | 'success' | 'warning' | 'danger' | 'neutral';
  className?: string;
}

const variantClasses = {
  info: 'bg-[var(--vscode-badge-background)] text-[var(--vscode-badge-foreground)]',
  success: 'bg-[var(--vscode-testing-iconPassed)]/15 text-[var(--vscode-testing-iconPassed)]',
  warning:
    'bg-[var(--vscode-editorWarning-foreground)]/15 text-[var(--vscode-editorWarning-foreground)]',
  danger:
    'bg-[var(--vscode-editorError-foreground)]/15 text-[var(--vscode-editorError-foreground)]',
  neutral: 'bg-[var(--vscode-editor-inactiveSelectionBackground)] text-[var(--vscode-foreground)]',
} as const;

export function Badge({ label, children, variant = 'neutral', className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-2 py-0.5 text-xs font-medium leading-5',
        variantClasses[variant],
        className,
      )}
    >
      {children ?? label}
    </span>
  );
}
