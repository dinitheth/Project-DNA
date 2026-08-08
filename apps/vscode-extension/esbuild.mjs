import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const workersOnly = process.argv.includes('--workers-only');
const entryPoints = workersOnly
  ? ['../../packages/ast-engine/src/workers/ast-worker.ts']
  : ['src/extension.ts', '../../packages/ast-engine/src/workers/ast-worker.ts'];

const ctx = await esbuild.context({
  entryPoints,
  bundle: true,
  outdir: 'dist',
  entryNames: '[name]',
  external: ['vscode', 'better-sqlite3', 'web-tree-sitter', 'tree-sitter-wasms'],
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  format: 'cjs',
  platform: 'node',
  sourcemap: true,
});

if (watch) {
  await ctx.watch();
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
