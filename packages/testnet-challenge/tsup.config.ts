import { defineConfig } from 'tsup';

// Two outputs with different bundling strategies:
//   - CLI (`dist/cli.js`): fully bundled — every dep goes in the JS so the
//     Docker image needs only a tiny node_modules. `@inquirer/*` and
//     `@noble/*` are the exceptions — their mixed CJS/ESM internals defeat
//     esbuild's static analysis (they work fine at runtime via Node).
//   - API (`dist/api.js`): deps externalized — runs on a host with regular
//     `pnpm --prod` install where bundling buys nothing.
//
// Asset loaders are needed for the CLI's text/CSS imports of the pre-built
// sign-page; harmless for the API entry.
export default defineConfig([
  {
    entry: { cli: 'src/cli/index.ts' },
    format: 'esm',
    platform: 'node',
    target: 'node22',
    outDir: 'dist',
    splitting: false,
    sourcemap: true,
    clean: true,
    treeshake: true,
    // Bundle everything except @inquirer/* and @noble/* (their barrel
    // re-exports defeat esbuild's static analysis).
    noExternal: [/^(?!(@inquirer\/|@noble\/)).*/],
    loader: {
      '.html': 'text',
      '.js': 'text',
      '.css': 'text',
      '.ans': 'text',
    },
  },
  {
    entry: { api: 'src/api/index.ts' },
    format: 'esm',
    platform: 'node',
    target: 'node22',
    outDir: 'dist',
    splitting: false,
    sourcemap: true,
    treeshake: true,
  },
]);
