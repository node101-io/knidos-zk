import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

import { zkTLSWindowMinutesSchema } from './shared/scheduler-config.js';

export const successMonitorEnv = createEnv({
  server: {
    APPRISE_NOTIFY_URL: z.url(),
    APPRISE_PASSWORD: z.string().min(1, 'APPRISE_PASSWORD cannot be empty'),
    APPRISE_USERNAME: z.string().min(1, 'APPRISE_USERNAME cannot be empty'),
    MONGO_URI: z.string().min(1, 'MONGO_URI cannot be empty'),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
    ZKTLS_WINDOW_MINUTES: zkTLSWindowMinutesSchema,
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
