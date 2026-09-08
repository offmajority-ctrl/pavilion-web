import { build } from 'esbuild';
import fs from 'fs'; import path from 'path';
const common = { entryPoints: ['src/pavilion-section.js'], bundle: true, minify: true, sourcemap: false, target: ['es2019'], legalComments: 'none' };
await build({ ...common, format: 'iife', globalName: 'Pavilion', outfile: 'dist/pavilion-section.js' });
await build({ ...common, format: 'esm', outfile: 'dist/pavilion-section.esm.js' });
// asset manifest (byte sizes) for the preloader's 0–100 counter
const walk = (d, rel = '') => fs.readdirSync(d).flatMap((f) => { const p = path.join(d, f); const r = rel ? rel + '/' + f : f; return fs.statSync(p).isDirectory() ? walk(p, r) : (f === 'manifest.json' ? [] : [[r, fs.statSync(p).size]]); });
fs.writeFileSync('assets/manifest.json', JSON.stringify(Object.fromEntries(walk('assets'))));
console.log('built');
