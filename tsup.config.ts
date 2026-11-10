import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: { compilerOptions: { ignoreDeprecations: '6.0' } },
    target: 'es2022',
    platform: 'neutral',
    clean: true,
    sourcemap: false,
    splitting: false,
  },
  {
    entry: { 'cli/bin': 'src/cli/bin.ts' },
    format: ['esm'],
    dts: false,
    target: 'node20',
    platform: 'node',
    sourcemap: false,
    splitting: false,
    banner: { js: '#!/usr/bin/env node' },
  },
]);
