import { build } from 'esbuild';
const common = { entryPoints: ['src/pavilion-section.js'], bundle: true, minify: true, sourcemap: false, target: ['es2019'], legalComments: 'none' };
await build({ ...common, format: 'iife', globalName: 'Pavilion', outfile: 'dist/pavilion-section.js' });
await build({ ...common, format: 'esm', outfile: 'dist/pavilion-section.esm.js' });
console.log('built');
