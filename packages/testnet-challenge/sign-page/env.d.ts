/// <reference types="vite/client" />

// CSS side-effect imports — Vite injects them into the bundle at build time;
// this declaration just tells TS the import path is valid.
declare module '*.css';
