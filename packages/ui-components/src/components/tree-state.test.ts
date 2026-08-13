import { describe, expect, it } from 'vitest';
import { flattenVisibleTreeItems, getTreeKeyResult, reconcileTreeFocus } from './tree-state.js';
import type { TreeItem } from './tree-view.js';

const items: TreeItem[] = [
  {
    id: 'architecture',
    label: 'Architecture',
    children: [
      { id: 'layers', label: 'Layers', children: [{ id: 'domain', label: 'Domain' }] },
      { id: 'evidence', label: 'Evidence' },
    ],
  },
  { id: 'dependencies', label: 'Dependencies' },
];

describe('tree navigation state', () => {
  it('flattens only expanded branches with deterministic levels and parents', () => {
    expect(flattenVisibleTreeItems(items, new Set(['architecture', 'layers']))).toEqual([
      { item: items[0], level: 1, parentId: undefined },
      { item: items[0]!.children![0], level: 2, parentId: 'architecture' },
      { item: items[0]!.children![0]!.children![0], level: 3, parentId: 'layers' },
      { item: items[0]!.children![1], level: 2, parentId: 'architecture' },
      { item: items[1], level: 1, parentId: undefined },
    ]);
  });

  it('ignores repeated IDs so cyclic or duplicated inputs cannot recurse forever', () => {
    const duplicate: TreeItem = { id: 'root', label: 'Duplicate' };
    const cyclic: TreeItem = { id: 'root', label: 'Root', children: [duplicate] };

    expect(flattenVisibleTreeItems([cyclic], new Set(['root']))).toEqual([
      { item: cyclic, level: 1, parentId: undefined },
    ]);
  });

  it('moves vertically and supports Home and End without leaving the visible range', () => {
    const visible = flattenVisibleTreeItems(items, new Set(['architecture']));

    expect(getTreeKeyResult(visible, 'architecture', 'ArrowUp', new Set())).toEqual({
      focusId: 'architecture',
    });
    expect(getTreeKeyResult(visible, 'architecture', 'ArrowDown', new Set())).toEqual({
      focusId: 'layers',
    });
    expect(getTreeKeyResult(visible, 'layers', 'End', new Set())).toEqual({
      focusId: 'dependencies',
    });
    expect(getTreeKeyResult(visible, 'dependencies', 'Home', new Set())).toEqual({
      focusId: 'architecture',
    });
  });

  it('expands, enters, collapses, and returns to parent with horizontal arrows', () => {
    const collapsed = flattenVisibleTreeItems(items, new Set());
    expect(getTreeKeyResult(collapsed, 'architecture', 'ArrowRight', new Set())).toEqual({
      focusId: 'architecture',
      expandId: 'architecture',
    });

    const expandedIds = new Set(['architecture']);
    const expanded = flattenVisibleTreeItems(items, expandedIds);
    expect(getTreeKeyResult(expanded, 'architecture', 'ArrowRight', expandedIds)).toEqual({
      focusId: 'layers',
    });
    expect(getTreeKeyResult(expanded, 'layers', 'ArrowLeft', expandedIds)).toEqual({
      focusId: 'architecture',
    });
    expect(getTreeKeyResult(expanded, 'architecture', 'ArrowLeft', expandedIds)).toEqual({
      focusId: 'architecture',
      collapseId: 'architecture',
    });
  });

  it('falls back to the first visible item when focus becomes stale', () => {
    const visible = flattenVisibleTreeItems(items, new Set());
    expect(reconcileTreeFocus(visible, 'removed')).toBe('architecture');
    expect(reconcileTreeFocus(visible, 'dependencies')).toBe('dependencies');
    expect(reconcileTreeFocus([], 'removed')).toBeUndefined();
    expect(getTreeKeyResult(visible, 'removed', 'ArrowDown', new Set())).toEqual({
      focusId: 'architecture',
    });
    expect(getTreeKeyResult([], 'removed', 'ArrowDown', new Set())).toBeUndefined();
  });
});
