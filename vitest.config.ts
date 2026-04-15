import { defineConfig } from 'vitest/config';

process.loadEnvFile('.env');

export default defineConfig({
  test: {
    testTimeout: 300_000,
    hookTimeout: 300_000,
    include: ['tests/**/*.test.ts'],
    pool: 'forks',
  },
});
