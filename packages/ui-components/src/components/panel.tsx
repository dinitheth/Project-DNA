/**
 * @module Panel
 * Container panel component.
 */
import React, { useState } from 'react';
import { cn } from '../utils/cn.js';

export interface PanelProps {
  title: string;
  children: React.ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  className?: string;
}

export const Panel: React.FC<PanelProps> = ({
  title,
  children,
  collapsible = false,
  defaultOpen = true,
  className,
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  // TODO: Implement full collapsible panel with animation
  return (
    <div className={cn('border border-[var(--vscode-panel-border)]', className)}>
      <div
        className="flex items-center justify-between px-3 py-2 bg-[var(--vscode-sideBarSectionHeader-background)]"
        onClick={() => collapsible && setIsOpen(!isOpen)}
        role={collapsible ? 'button' : undefined}
        tabIndex={collapsible ? 0 : undefined}
      >
        <span className="text-xs font-semibold uppercase text-[var(--vscode-sideBarSectionHeader-foreground)]">
          {title}
        </span>
        {collapsible && (
          <span className="text-[var(--vscode-foreground)]">{isOpen ? '▾' : '▸'}</span>
        )}
      </div>
      {isOpen && <div className="p-3">{children}</div>}
    </div>
  );
};
