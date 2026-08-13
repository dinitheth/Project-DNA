/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
    '../../../packages/ui-components/src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        vscode: {
          background: 'var(--vscode-editor-background)',
          foreground: 'var(--vscode-editor-foreground)',
          button: 'var(--vscode-button-background)',
          buttonHover: 'var(--vscode-button-hoverBackground)',
          buttonForeground: 'var(--vscode-button-foreground)',
        },
        panel: 'var(--vscode-sideBarSectionHeader-background)',
        'panel-border': 'var(--vscode-panel-border)',
        description: 'var(--vscode-descriptionForeground)',
        'list-hover': 'var(--vscode-list-hoverBackground)',
        badge: 'var(--vscode-badge-background)',
        'badge-foreground': 'var(--vscode-badge-foreground)',
        progress: 'var(--vscode-progressBar-background)',
        'progress-background': 'var(--vscode-input-background)',
        error: 'var(--vscode-errorForeground)',
      },
    },
  },
  plugins: [],
};
