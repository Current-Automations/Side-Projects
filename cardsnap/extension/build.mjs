import esbuild from 'esbuild';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outdir = resolve(__dirname, 'dist');

await Promise.all([
  esbuild.build({
    entryPoints: [resolve(__dirname, 'src/background.ts')],
    bundle: true,
    outfile: resolve(outdir, 'background.js'),
    format: 'esm',
    target: 'chrome120',
    platform: 'browser',
  }),
  esbuild.build({
    entryPoints: [resolve(__dirname, 'src/content.ts')],
    bundle: true,
    outfile: resolve(outdir, 'content.js'),
    format: 'iife',
    target: 'chrome120',
    platform: 'browser',
  }),
  esbuild.build({
    entryPoints: [resolve(__dirname, 'src/popup.ts')],
    bundle: true,
    outfile: resolve(outdir, 'popup.js'),
    format: 'iife',
    target: 'chrome120',
    platform: 'browser',
  }),
]);

console.log('Extension built to extension/dist/');
