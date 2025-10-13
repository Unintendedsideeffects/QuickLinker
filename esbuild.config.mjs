import esbuild from 'esbuild';
import process from 'process';
import builtins from 'builtin-modules';

const banner = `/*\n  This file is bundled by esbuild from src/main.ts.\n  Edit the source files instead of dist/main.js.\n*/\n`;

const production = process.argv[2] === 'production';

const context = await esbuild.context({
  banner: {
    js: banner,
  },
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: [
    'obsidian',
    'electron',
    '@codemirror/autocomplete',
    '@codemirror/collab',
    '@codemirror/commands',
    '@codemirror/language',
    '@codemirror/lint',
    '@codemirror/search',
    '@codemirror/state',
    '@codemirror/view',
    '@lezer/common',
    '@lezer/highlight',
    '@lezer/lr',
    ...builtins,
  ],
  format: 'cjs',
  target: 'es2018',
  logLevel: 'info',
  sourcemap: production ? false : 'inline',
  treeShaking: true,
  outfile: 'dist/main.js',
  minify: production,
});

if (production) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.rebuild();
  await context.watch();
}
