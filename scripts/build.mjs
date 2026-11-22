import { build } from 'esbuild';
import { mkdir, cp, writeFile, readFile, rm } from 'node:fs/promises';
import { resolve, dirname, basename } from 'node:path';
await mkdir('vendor', { recursive: true });
await build({ stdin: { contents: 'export { createClient } from "@supabase/supabase-js";', resolveDir: process.cwd(), loader: 'js' }, bundle: true, format: 'esm', platform: 'browser', minify: true, outfile: 'vendor/supabase.js' });
await build({ stdin: { contents: 'export { toDataURL } from "qrcode";', resolveDir: process.cwd(), loader: 'js' }, bundle: true, format: 'esm', platform: 'browser', minify: true, outfile: 'vendor/qrcode.js' });
const output=resolve('dist');
if(dirname(output)!==resolve('.')||basename(output)!=='dist')throw new Error('Unexpected build output directory');
await rm(output,{recursive:true,force:true});
await mkdir(output, { recursive: true });
for (const item of ['index.html', 'club.html', 'portal.css', 'styles.css', 'config.js', 'js', 'vendor', 'assets']) await cp(item, `dist/${item}`, { recursive: true });
// Exact allowlist: no .env files, SQL, server scripts, or dependency tree are published.
try {
  const env = Object.fromEntries((await readFile('.env.local', 'utf8')).split(/\r?\n/).filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; }));
  if (env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    const { config } = await import('../config.js');
    await writeFile('dist/config.js', `export const config = ${JSON.stringify({ ...config, supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL, supabaseKey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY }, null, 2)};\n`);
  }
} catch (e) { if (e.code !== 'ENOENT') throw e; }
console.log('Built static frontend in dist/. Public Supabase settings only.');
