/**
 * @module TreeView
 * Collapsible tree view component using VS Code CSS variables.
 */
import React from 'react';
import { cn } from '../utils/cn.js';

export interface TreeItem {
  id: string;
  label: string;
  children?: TreeItem[];
}

export interface TreeViewProps {
  items: TreeItem[];
  onSelect?: (item: TreeItem) => void;
  className?: string;
}

export const TreeView: React.FC<TreeViewProps> = ({ items, onSelect, className }) => {
  // TODO: Implement full collapsible tree with nested children, keyboard navigation, and icons
  return (
    <div className={cn('text-[var(--vscode-foreground)]', className)}>
      <ul className="list-none p-0 m-0">
        {items.map((item) => (
          <li
            key={item.id}
            className="px-3 py-1 cursor-pointer hover:bg-[var(--vscode-list-hoverBackground)]"
            onClick={() => onSelect?.(item)}
          >
            <span className="text-sm">{item.label}</span>
            {item.children && item.children.length > 0 && (
              <span className="ml-1 text-xs opacity-60">({item.children.length})</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
};
