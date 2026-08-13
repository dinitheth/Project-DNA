import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Badge } from './badge.js';
import { Icon } from './icon.js';
import { Panel } from './panel.js';
import { SectionHeader } from './section-header.js';
import { StatusIndicator } from './status-indicator.js';
import { activateTreeItem, TreeView, type TreeItem } from './tree-view.js';

describe('accessible UI components', () => {
  it('renders semantic badge variants and labelled or decorative icons', () => {
    expect(renderToStaticMarkup(<Badge variant="danger">Critical</Badge>)).toContain('Critical');
    expect(renderToStaticMarkup(<Icon name="warning" />)).toContain('aria-hidden="true"');
    expect(renderToStaticMarkup(<Icon label="Warning" name="warning" />)).toContain(
      'aria-label="Warning"',
    );
  });

  it('renders collapsible panels as native buttons with controlled content', () => {
    const markup = renderToStaticMarkup(
      <Panel collapsible defaultOpen={false} title="Details">
        Content
      </Panel>,
    );

    expect(markup).toContain('<button');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('aria-controls=');
    expect(markup).toContain('hidden=""');
  });

  it('labels section actions and status text without relying only on colour', () => {
    expect(
      renderToStaticMarkup(
        <SectionHeader
          action="Refresh"
          actionLabel="Refresh intelligence"
          onAction={() => {}}
          title="Health"
        />,
      ),
    ).toContain('aria-label="Refresh intelligence"');
    const status = renderToStaticMarkup(
      <StatusIndicator label="Analysis complete" status="success" />,
    );
    expect(status).toContain('role="status"');
    expect(status).toContain('Status: success');
  });

  it('renders a nested ARIA tree with roving focus and expansion state', () => {
    const markup = renderToStaticMarkup(
      <TreeView
        ariaLabel="Architecture tree"
        defaultExpandedIds={['architecture']}
        items={[
          {
            id: 'architecture',
            label: 'Architecture',
            children: [{ id: 'layers', label: 'Layers' }],
          },
        ]}
      />,
    );

    expect(markup).toContain('role="tree"');
    expect(markup).toContain('aria-label="Architecture tree"');
    expect(markup).toContain('role="treeitem"');
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain('aria-level="2"');
    expect(markup.match(/tabindex="0"/gu)).toHaveLength(1);
  });

  it('routes pointer and keyboard activation through the same selection behavior', () => {
    const onSelect = vi.fn();
    const toggle = vi.fn();
    const item: TreeItem = { id: 'architecture', label: 'Architecture' };

    activateTreeItem(item, onSelect, toggle);

    expect(onSelect).toHaveBeenCalledWith(item);
    expect(toggle).toHaveBeenCalledWith(item);
  });
});
