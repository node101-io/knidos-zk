import { existsSync } from 'fs';

import { defineConfig } from 'vitest/config';

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

const FAST_TIMEOUT = 30_000;
const SLOW_TIMEOUT = 300_000;
const NOIR_GLOBAL_SETUP = './tests/setup/noir-proof.global-setup.ts';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/scripts/**', 'src/**/types.ts', 'src/env.ts'],
    },
    projects: [
      {
        test: {
          name: 'unit',
          pool: 'forks',
          testTimeout: FAST_TIMEOUT,
          hookTimeout: FAST_TIMEOUT,
          include: [
            'tests/primus-task.test.ts',
            'tests/primus-capacity.test.ts',
            'tests/scheduler-utils.test.ts',
            'tests/validation.test.ts',
            'tests/logger.test.ts',
            'tests/server.test.ts',
            'tests/zk-tls-master.test.ts',
            'tests/zk-tls-worker.test.ts',
            'tests/zk-verify-session.test.ts',
          ],
        },
      },
      {
        test: {
          name: 'integration',
          pool: 'forks',
          testTimeout: SLOW_TIMEOUT,
          hookTimeout: SLOW_TIMEOUT,
          include: ['tests/noir-compile.test.ts', 'tests/noir-proof.test.ts'],
          globalSetup: [NOIR_GLOBAL_SETUP],
        },
      },
      {
        test: {
          name: 'e2e',
          pool: 'forks',
          testTimeout: SLOW_TIMEOUT,
          hookTimeout: SLOW_TIMEOUT,
          include: ['tests/zk-tls.test.ts', 'tests/zk-verify.test.ts'],
          globalSetup: [NOIR_GLOBAL_SETUP],
        },
      },
    ],
  },
});
