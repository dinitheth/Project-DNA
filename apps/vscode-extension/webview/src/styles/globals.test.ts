import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const stylesheet = readFileSync(new URL('./globals.css', import.meta.url), 'utf8');
const tailwindConfig = readFileSync(new URL('../../tailwind.config.ts', import.meta.url), 'utf8');

describe('DNA Graphite visual tokens', () => {
  it('defines the approved dark palette through semantic tokens', () => {
    expect(stylesheet).toContain('--dna-background: #000000;');
    expect(stylesheet).toContain('--dna-surface: #0c0c0e;');
    expect(stylesheet).toContain('--dna-surface-hover: #141417;');
    expect(stylesheet).toContain('--dna-border: rgba(255, 255, 255, 0.08);');
    expect(stylesheet).toContain('--dna-foreground: #f5f5f7;');
    expect(stylesheet).toContain('--dna-muted: #8e8e93;');
    expect(stylesheet).toContain('--dna-active: #222226;');
  });

  it('maps light and high-contrast themes to VS Code colors', () => {
    expect(stylesheet).toContain('body.vscode-light');
    expect(stylesheet).toContain('--dna-background: var(--vscode-editor-background, #ffffff);');
    expect(stylesheet).toContain('body.vscode-high-contrast');
    expect(stylesheet).toContain('body.vscode-high-contrast-light');
    expect(stylesheet).toContain('--dna-border: var(--vscode-contrastBorder, CanvasText);');
  });

  it('uses the tokens for the webview foundation and exposes them to Tailwind', () => {
    expect(stylesheet).toContain('color: var(--dna-foreground);');
    expect(stylesheet).toContain('background-color: var(--dna-background);');
    for (const token of [
      'active',
      'background',
      'border',
      'foreground',
      'muted',
      'surface',
      'surface-hover',
    ]) {
      const cssToken = token === 'surface-hover' ? '--dna-surface-hover' : `--dna-${token}`;
      expect(tailwindConfig).toContain(`var(${cssToken})`);
    }
  });

  it('preserves visible focus and respects both reduced-motion signals', () => {
    expect(stylesheet).toContain(':focus-visible');
    expect(stylesheet).toContain('var(--vscode-focusBorder, #ffffff)');
    expect(stylesheet).toContain('body.vscode-reduce-motion');
    expect(stylesheet).toContain('@media (prefers-reduced-motion: reduce)');
    expect(stylesheet).toContain('animation-duration: 0.01ms !important;');
    expect(stylesheet).toContain('transition-duration: 0.01ms !important;');
  });
});
