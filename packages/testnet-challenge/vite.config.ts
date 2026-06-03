import path from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Builds the browser-side sign-page (React + RainbowKit + wagmi) into a
// single self-contained HTML file. tsup then text-loads that one file into
// the Node CLI bundle.
//
// We pin esbuild to React's JSX runtime explicitly. The workspace's base
// tsconfig sets `jsxImportSource: "hono/jsx"` (used for the Hono API
// server's JSX templates) and Vite would otherwise inherit that here.
export default defineConfig({
  root: path.resolve(import.meta.dirname, 'sign-page'),
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
  build: {
    // Default output (`sign-page/dist/`). Lives next to its source so the
    // pair mirrors the `src/` ↔ `dist/` layout used by Node code.
    emptyOutDir: true,
    sourcemap: false,
    minify: true,
    cssCodeSplit: false,
  },
  plugins: [react(), viteSingleFile()],
});
