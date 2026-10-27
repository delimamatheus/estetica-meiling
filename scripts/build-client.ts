// Empacota o front-end TypeScript (src/client) em public/app.js
import { build } from 'esbuild';

build({
  entryPoints: ['src/client/main.ts'],
  outfile: 'public/app.js',
  bundle: true,
  minify: process.argv.includes('--minify'),
  sourcemap: true,
  target: 'es2020',
  logLevel: 'info',
}).catch(() => process.exit(1));
