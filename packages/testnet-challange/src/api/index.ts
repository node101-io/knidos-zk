import { serve } from '@hono/node-server';
import { OpenAPIHono } from '@hono/zod-openapi';
import { Scalar } from '@scalar/hono-api-reference';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import mongoose from 'mongoose';

import { env } from './lib/env.js';
import { completedRoutes } from './routes/completed.js';
import { submitRoutes } from './routes/submit.js';

// Return the documented `{ error }` shape on Zod validation failures
// instead of OpenAPIHono's default `{ success, error: ZodError }` envelope,
// so consumers see the same schema we publish in /api/openapi.json.
const app = new OpenAPIHono({
  defaultHook: (result, c) => {
    if (!result.success) {
      const first = result.error.issues[0];
      const message = first
        ? `${first.path.join('.') || 'request'}: ${first.message}`
        : 'invalid request';
      return c.json({ error: message }, 400);
    }
  },
});

app.use('*', logger());
app.use(
  '/api/*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['content-type'],
    maxAge: 600,
  }),
);

app.get('/api/health', (c) => c.json({ status: 'ok' }));

app.route('/', submitRoutes);
app.route('/', completedRoutes);

app.doc('/api/openapi.json', {
  openapi: '3.1.0',
  info: {
    title: 'Knidos Testnet Challenge API',
    version: '1.0.0',
    description:
      'Backend for the Knidos ZK testnet challenge CLI. The CLI grades user attempts locally and submits passing runs here; this service re-verifies SIWE signatures, regrades against the deterministic mask, and persists the best score per address.',
  },
  servers: [{ url: '/', description: 'Same origin' }],
});

app.get(
  '/api/docs',
  Scalar({
    url: '/api/openapi.json',
    pageTitle: 'Knidos Challenge API',
    theme: 'default',
  }),
);

// Fail fast if mongo is unreachable at startup so we don't accept submits
// that will silently fail to persist.
await mongoose.connect(env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });

serve({ fetch: app.fetch, port: env.PORT }, ({ port }) => {
  console.log(`testnet-challange-api listening on :${port}`);
});
