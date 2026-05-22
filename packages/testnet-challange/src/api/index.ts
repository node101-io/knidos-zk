import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import mongoose from 'mongoose';

import { env } from './lib/env.js';
import { completedRoutes } from './routes/completed.js';
import { submitRoutes } from './routes/submit.js';

const app = new Hono();

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

// Fail fast if mongo is unreachable at startup so we don't accept submits
// that will silently fail to persist.
await mongoose.connect(env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });

serve({ fetch: app.fetch, port: env.PORT }, ({ port }) => {
  console.log(`testnet-challange-api listening on :${port}`);
});
