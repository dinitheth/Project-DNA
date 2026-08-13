import { useId, useState, type ReactNode } from 'react';
import { cn } from '../utils/cn.js';
import { Icon } from './icon.js';

export interface PanelProps {
  title: string;
  children: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  className?: string;
}

export function Panel({
  title,
  children,
  collapsible = false,
  defaultOpen = true,
  className,
}: PanelProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const contentId = useId();

  return (
    <section className={cn('rounded border border-[var(--vscode-panel-border)]', className)}>
      {collapsible ? (
        <button
          aria-controls={contentId}
          aria-expanded={isOpen}
          className="flex w-full items-center justify-between gap-2 bg-[var(--vscode-sideBarSectionHeader-background)] px-3 py-2 text-left"
          onClick={() => setIsOpen((open) => !open)}
          type="button"
        >
          <span className="text-xs font-semibold uppercase text-[var(--vscode-sideBarSectionHeader-foreground)]">
            {title}
          </span>
          <Icon name={isOpen ? 'chevron-down' : 'chevron-right'} />
        </button>
      ) : (
        <div className="bg-[var(--vscode-sideBarSectionHeader-background)] px-3 py-2">
          <span className="text-xs font-semibold uppercase text-[var(--vscode-sideBarSectionHeader-foreground)]">
            {title}
          </span>
        </div>
      )}
      <div hidden={!isOpen} id={contentId}>
        <div className="p-3">{children}</div>
      </div>
    </section>
  );
}
