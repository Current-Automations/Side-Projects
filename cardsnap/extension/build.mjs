import esbuild from 'esbuild';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outdir = resolve(__dirname, 'dist');

// Baked into dist/ (gitignored) from .env.local. The anon key is Supabase's
// public client key; the service role key never goes near the extension.
const define = {
  __API_BASE__: JSON.stringify(process.env.CARDSNAP_API_BASE ?? 'http://localhost:3000'),
  __SUPABASE_URL__: JSON.stringify(process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''),
  __SUPABASE_ANON_KEY__: JSON.stringify(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''),
};

await Promise.all([
  esbuild.build({
    entryPoints: [resolve(__dirname, 'src/background.ts')],
    bundle: true,
    outfile: resolve(outdir, 'background.js'),
    format: 'esm',
    target: 'chrome120',
    platform: 'browser',
    define,
  }),
  esbuild.build({
    entryPoints: [resolve(__dirname, 'src/content.ts')],
    bundle: true,
    outfile: resolve(outdir, 'content.js'),
    format: 'iife',
    target: 'chrome120',
    platform: 'browser',
    define,
  }),
  esbuild.build({
    entryPoints: [resolve(__dirname, 'src/popup.ts')],
    bundle: true,
    outfile: resolve(outdir, 'popup.js'),
    format: 'iife',
    target: 'chrome120',
    platform: 'browser',
    define,
  }),
]);

console.log('Extension built to extension/dist/');
