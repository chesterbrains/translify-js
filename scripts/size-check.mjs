// The library's browser entry must stay under the budget the spec sets (3 KB min+gzip).
// Measured on a minified bundle so the published, readable dist is not what is judged.
import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';

const BUDGET = 3072;

const result = await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  minify: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  write: false,
});

const bytes = gzipSync(result.outputFiles[0].contents).length;
console.log(`index.js min+gzip: ${bytes} bytes (budget ${BUDGET})`);
if (bytes > BUDGET) {
  console.error(`size budget exceeded by ${bytes - BUDGET} bytes`);
  process.exit(1);
}
