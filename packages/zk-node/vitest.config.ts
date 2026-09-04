import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { defineConfig } from 'vitest/config';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ENV_FILE = path.join(REPO_ROOT, '.env');
if (existsSync(ENV_FILE)) {
  process.loadEnvFile(ENV_FILE);
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
            'tests/primus-client.test.ts',
            'tests/primus-errors.test.ts',
            'tests/error-utils.test.ts',
            'tests/apprise.test.ts',
            'tests/scheduler-utils.test.ts',
            'tests/success-monitor-policy.test.ts',
            'tests/validation.test.ts',
            'tests/logger.test.ts',
            'tests/server.test.ts',
            'tests/task-wave-retention.test.ts',
            'tests/zk-tls-master.test.ts',
            'tests/zk-tls-worker.test.ts',
            'tests/zk-verify-session.test.ts',
            'tests/registered-vk-helpers.test.ts',
            'tests/pad-raw-fills.test.ts',
            'tests/retry-policy.test.ts',
            'tests/circuit-limits.test.ts',
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
          name: 'e2e-zktls',
          pool: 'forks',
          testTimeout: SLOW_TIMEOUT,
          hookTimeout: SLOW_TIMEOUT,
          include: ['tests/zk-tls.test.ts'],
        },
      },
      {
        test: {
          name: 'e2e-zkverify',
          pool: 'forks',
          testTimeout: SLOW_TIMEOUT,
          hookTimeout: SLOW_TIMEOUT,
          include: ['tests/zk-verify.test.ts'],
          globalSetup: [NOIR_GLOBAL_SETUP],
        },
      },
    ],
  },
});
