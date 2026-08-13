import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SidebarNavigation, StatusPanel } from './App.js';

describe('webview accessibility semantics', () => {
  it('marks exactly the active sidebar route as the current page', () => {
    const markup = renderToStaticMarkup(
      <SidebarNavigation activeRoute="architecture" onNavigate={() => undefined} />,
    );

    expect(markup.match(/aria-current="page"/gu)).toHaveLength(1);
    expect(markup).toMatch(/aria-current="page"[^>]*>architecture<\/button>/u);
  });

  it('keeps route controls as native buttons with deterministic activation', () => {
    const onNavigate = vi.fn();
    const navigation = SidebarNavigation({ activeRoute: 'overview', onNavigate });
    const routeControl = navigation.props.children[0].props.children[1];
    const architectureButton = routeControl.type(routeControl.props);

    architectureButton.props.onClick();

    expect(architectureButton.props.type).toBe('button');
    expect(onNavigate).toHaveBeenCalledWith('architecture');
  });

  it('announces analysis status and exposes bounded determinate progress', () => {
    const markup = renderToStaticMarkup(
      <StatusPanel message="Indexing files" progress={120} title="Analyzing repository" />,
    );

    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('role="progressbar"');
    expect(markup).toContain('aria-valuemin="0"');
    expect(markup).toContain('aria-valuemax="100"');
    expect(markup).toContain('aria-valuenow="100"');
    expect(markup).toContain('width:100%');
  });

  it('announces analysis failures assertively', () => {
    const markup = renderToStaticMarkup(
      <StatusPanel message="Database unavailable" title="Analysis failed" tone="error" />,
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain('aria-live="assertive"');
  });
});
