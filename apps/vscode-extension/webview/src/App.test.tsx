import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SidebarNavigation, StatusPanel, WorkspaceHeader } from './App.js';

describe('webview accessibility semantics', () => {
  it('marks exactly the active sidebar route as the current page', () => {
    const markup = renderToStaticMarkup(
      <SidebarNavigation activeRoute="architecture" onNavigate={() => undefined} />,
    );

    const currentButtons = markup.match(/<button[^>]*aria-current="page"[^>]*>.*?<\/button>/gu);
    expect(currentButtons).toHaveLength(1);
    expect(currentButtons?.[0]).toContain('aria-label="Architecture"');
    expect(currentButtons?.[0]).toContain('>Arch</button>');
    expect(currentButtons?.[0]).not.toContain('aria-label="Overview"');
  });

  it('keeps every route keyboard-accessible through native buttons', () => {
    const markup = renderToStaticMarkup(
      <SidebarNavigation activeRoute="overview" onNavigate={() => undefined} />,
    );

    expect(markup.match(/<button/gu)).toHaveLength(5);
    expect(markup.match(/type="button"/gu)).toHaveLength(5);
    expect(markup).toContain('aria-label="Overview"');
    expect(markup).toContain('>Home</button>');
    expect(markup).toContain('aria-label="Dependencies"');
    expect(markup).toContain('>Deps</button>');
    expect(markup).toContain('title="Architecture"');
    expect(markup).not.toContain('tabindex="-1"');
  });

  it('keeps deterministic route activation wired to the navigation callback', () => {
    const onNavigate = vi.fn();
    const navigation = SidebarNavigation({ activeRoute: 'overview', onNavigate });
    const routeControl = navigation.props.children.props.children[1];
    const architectureButton = routeControl.type(routeControl.props);

    architectureButton.props.onClick();

    expect(architectureButton.props.type).toBe('button');
    expect(onNavigate).toHaveBeenCalledWith('architecture');
  });

  it('keeps every route in one compact navigation row', () => {
    const markup = renderToStaticMarkup(
      <SidebarNavigation activeRoute="overview" onNavigate={() => undefined} />,
    );

    expect(markup).toContain('grid-cols-5');
    expect(markup).not.toContain('min-[190px]:grid-cols-2');
    expect(markup).toContain('whitespace-nowrap');
    expect(markup).toContain('text-ellipsis');
    expect(markup).toContain('min-h-8');
    expect(markup).toContain('min-w-0');
  });

  it('renders repository context from existing workspace state', () => {
    const markup = renderToStaticMarkup(
      <WorkspaceHeader repositoryName="Project DNA" workspaceRoot={'C:\\work\\project-dna'} />,
    );

    expect(markup).toMatch(/<h1[^>]*>Project DNA<\/h1>/u);
    expect(markup).not.toMatch(/<p[^>]*>Project DNA<\/p>/u);
    expect(markup).not.toContain('C:\\work\\project-dna');
    expect(markup).not.toContain('version');
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
