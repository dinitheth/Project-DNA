import type { TreeItem } from './tree-view.js';

export interface VisibleTreeItem {
  readonly item: TreeItem;
  readonly level: number;
  readonly parentId?: string;
}

export type TreeKey = 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'End' | 'Home';

export interface TreeKeyResult {
  readonly focusId: string;
  readonly expandId?: string;
  readonly collapseId?: string;
}

export function reconcileTreeFocus(
  visible: readonly VisibleTreeItem[],
  focusedId: string | undefined,
): string | undefined {
  return focusedId && visible.some(({ item }) => item.id === focusedId)
    ? focusedId
    : visible[0]?.item.id;
}

export function flattenVisibleTreeItems(
  items: readonly TreeItem[],
  expandedIds: ReadonlySet<string>,
): VisibleTreeItem[] {
  const visible: VisibleTreeItem[] = [];
  const seen = new Set<string>();
  const visit = (nestedItems: readonly TreeItem[], level: number, parentId?: string) => {
    for (const item of nestedItems) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      visible.push({ item, level, parentId });
      if (item.children && expandedIds.has(item.id)) visit(item.children, level + 1, item.id);
    }
  };
  visit(items, 1);
  return visible;
}

export function getTreeKeyResult(
  visible: readonly VisibleTreeItem[],
  focusedId: string,
  key: TreeKey,
  expandedIds: ReadonlySet<string>,
): TreeKeyResult | undefined {
  const index = visible.findIndex(({ item }) => item.id === focusedId);
  if (index < 0) return visible[0] ? { focusId: visible[0].item.id } : undefined;
  const current = visible[index]!;
  switch (key) {
    case 'ArrowDown':
      return { focusId: visible[Math.min(index + 1, visible.length - 1)]!.item.id };
    case 'ArrowUp':
      return { focusId: visible[Math.max(index - 1, 0)]!.item.id };
    case 'Home':
      return { focusId: visible[0]!.item.id };
    case 'End':
      return { focusId: visible.at(-1)!.item.id };
    case 'ArrowRight':
      if (!current.item.children?.length) return { focusId: current.item.id };
      if (!expandedIds.has(current.item.id)) {
        return { focusId: current.item.id, expandId: current.item.id };
      }
      return { focusId: current.item.children[0]!.id };
    case 'ArrowLeft':
      if (current.item.children?.length && expandedIds.has(current.item.id)) {
        return { focusId: current.item.id, collapseId: current.item.id };
      }
      return { focusId: current.parentId ?? current.item.id };
  }
}
