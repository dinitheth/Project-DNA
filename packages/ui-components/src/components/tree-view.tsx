import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { cn } from '../utils/cn.js';
import { Icon } from './icon.js';
import {
  flattenVisibleTreeItems,
  getTreeKeyResult,
  reconcileTreeFocus,
  type TreeKey,
} from './tree-state.js';

export interface TreeItem {
  id: string;
  label: string;
  children?: TreeItem[];
  description?: string;
}

export interface TreeViewProps {
  items: TreeItem[];
  onSelect?: (item: TreeItem) => void;
  defaultExpandedIds?: readonly string[];
  ariaLabel?: string;
  className?: string;
}

export function TreeView({
  items,
  onSelect,
  defaultExpandedIds = [],
  ariaLabel = 'Tree',
  className,
}: TreeViewProps) {
  const [expandedIds, setExpandedIds] = useState(() => new Set(defaultExpandedIds));
  const visible = useMemo(() => flattenVisibleTreeItems(items, expandedIds), [items, expandedIds]);
  const [focusedId, setFocusedId] = useState(() => visible[0]?.item.id);
  const effectiveFocusedId = reconcileTreeFocus(visible, focusedId);
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());

  const focus = (id: string) => {
    setFocusedId(id);
    queueMicrotask(() => itemRefs.current.get(id)?.focus());
  };

  const toggle = (item: TreeItem) => {
    if (!item.children?.length) return;
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, item: TreeItem) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect?.(item);
      if (item.children?.length) toggle(item);
      return;
    }
    if (!isTreeKey(event.key)) return;
    event.preventDefault();
    const result = getTreeKeyResult(visible, item.id, event.key, expandedIds);
    if (!result) return;
    if (result.expandId || result.collapseId) {
      setExpandedIds((current) => {
        const next = new Set(current);
        if (result.expandId) next.add(result.expandId);
        if (result.collapseId) next.delete(result.collapseId);
        return next;
      });
    }
    focus(result.focusId);
  };

  return (
    <ul
      aria-label={ariaLabel}
      className={cn('m-0 list-none p-0 text-[var(--vscode-foreground)]', className)}
      role="tree"
    >
      {visible.map(({ item, level }) => {
        const expandable = Boolean(item.children?.length);
        const expanded = expandable && expandedIds.has(item.id);
        return (
          <li key={item.id} role="none">
            <button
              aria-expanded={expandable ? expanded : undefined}
              aria-level={level}
              className="flex w-full items-start gap-1 rounded px-2 py-1 text-left hover:bg-[var(--vscode-list-hoverBackground)] focus:bg-[var(--vscode-list-focusBackground)] focus:outline focus:outline-1 focus:outline-[var(--vscode-focusBorder)]"
              onClick={() => {
                focus(item.id);
                onSelect?.(item);
              }}
              onDoubleClick={() => toggle(item)}
              onKeyDown={(event) => handleKeyDown(event, item)}
              ref={(element) => {
                if (element) itemRefs.current.set(item.id, element);
                else itemRefs.current.delete(item.id);
              }}
              role="treeitem"
              style={{ paddingLeft: `${(level - 1) * 16 + 8}px` }}
              tabIndex={effectiveFocusedId === item.id ? 0 : -1}
              type="button"
            >
              <span className="mt-0.5 inline-flex h-4 w-4 items-center justify-center">
                {expandable ? (
                  <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={14} />
                ) : null}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm">{item.label}</span>
                {item.description ? (
                  <span className="block truncate text-xs text-[var(--vscode-descriptionForeground)]">
                    {item.description}
                  </span>
                ) : null}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function isTreeKey(value: string): value is TreeKey {
  return ['ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'End', 'Home'].includes(value);
}
