import { cn } from '../utils/cn.js';
import { Icon, type IconName } from './icon.js';

export interface StatusIndicatorProps {
  status: 'idle' | 'running' | 'success' | 'error';
  label: string;
  className?: string;
}

const statusPresentation: Record<
  StatusIndicatorProps['status'],
  { icon: IconName; className: string }
> = {
  idle: { icon: 'circle', className: 'text-[var(--vscode-descriptionForeground)]' },
  running: { icon: 'info', className: 'text-[var(--vscode-progressBar-background)]' },
  success: { icon: 'success', className: 'text-[var(--vscode-testing-iconPassed)]' },
  error: { icon: 'error', className: 'text-[var(--vscode-editorError-foreground)]' },
};

export function StatusIndicator({ status, label, className }: StatusIndicatorProps) {
  const presentation = statusPresentation[status];
  return (
    <div className={cn('flex items-center gap-2', presentation.className, className)} role="status">
      <Icon name={presentation.icon} />
      <span>{label}</span>
      <span className="sr-only">Status: {status}</span>
    </div>
  );
}
