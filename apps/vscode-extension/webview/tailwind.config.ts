/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
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
        }
      }
    },
  },
  plugins: [],
}
