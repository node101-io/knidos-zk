import { defineConfig } from 'tsup';

// Two ESM entries — `cli` (the docker bin) and `api` (the Hono server).
// Dependencies stay external; the image installs them via `pnpm --prod`. We
// do inline non-JS assets:
//   - HTML / sign-page client.js → text loader (string literal in bundle)
//   - records.json → resolveJsonModule (esbuild handles natively)
// The CLI entry begins with `#!/usr/bin/env node`; esbuild preserves it.
export default defineConfig({
  entry: {
    cli: 'src/cli/index.ts',
    api: 'src/api/index.ts',
  },
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  splitting: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
  loader: {
    '.html': 'text',
    '.js': 'text',
    '.css': 'text',
  },
});
