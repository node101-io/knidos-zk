import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export const successMonitorEnv = createEnv({
  server: {
    APPRISE_NOTIFY_URL: z.url(),
    MONGO_URI: z.string().min(1, 'MONGO_URI cannot be empty'),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
