import { serve } from '@hono/node-server';
import { swaggerUI } from '@hono/swagger-ui';
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { cors } from 'hono/cors';
import { createMiddleware } from 'hono/factory';
import { logger as honoLogger } from 'hono/logger';
import mongoose, { Types } from 'mongoose';

import { expectedVerdicts, getCorruptionMask, scoreAnswers } from '../corruption.js';
import { parseSiweMessage, verifySiwePersonalSig } from '../siwe-lite.js';
import {
  ANSWER_VERDICTS,
  PASS_THRESHOLD,
  RECORD_COUNT,
  type AnswerVerdict,
} from '../types.js';
import { CompletedAddress } from './db/completed-address.js';
import { env } from './lib/env.js';

// --- schemas ---

const ErrorResponseSchema = z
  .object({
    error: z.string().openapi({ description: 'Error message', example: 'Bad Request' }),
  })
  .openapi('ErrorResponse');

// /api/submit is intentionally NOT exposed in the OpenAPI doc — it's an
// internal endpoint hit only by the CLI. Schemas without `.openapi(name)`
// stay out of the spec's `components` and aren't surfaced anywhere.
const SubmitRequestSchema = z.object({
  message: z.string().min(1),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
  answers: z
    .array(z.enum(ANSWER_VERDICTS as unknown as [AnswerVerdict, ...AnswerVerdict[]]))
    .length(RECORD_COUNT),
});

const CompletedQuerySchema = z.object({
  cursor: z
    .string()
    .regex(/^[a-f\d]{24}$/i, 'Must be a valid 24-character hex ObjectId')
    .optional()
    .openapi({
      param: { name: 'cursor', in: 'query' },
      description: 'Pagination cursor (MongoDB ObjectId)',
      example: '507f1f77bcf86cd799439011',
    }),
  min_score: z.coerce
    .number()
    .int()
    .min(PASS_THRESHOLD)
    .max(RECORD_COUNT)
    .optional()
    .openapi({
      param: { name: 'min_score', in: 'query' },
      description: `Only return entries whose best score is >= this value (${PASS_THRESHOLD}..${RECORD_COUNT}).`,
      example: 5,
    }),
});

const CompletedItemSchema = z
  .object({
    address: z
      .string()
      .regex(/^0x[0-9a-f]{40}$/)
      .openapi({
        description: 'Lower-cased Ethereum address that completed the challenge.',
        example: '0x1234567890abcdef1234567890abcdef12345678',
      }),
    completed_at: z.string().openapi({
      description: 'ISO 8601 timestamp of when this address first cleared the threshold.',
      example: '2026-05-29T12:34:56.789Z',
    }),
    score: z
      .number()
      .int()
      .min(PASS_THRESHOLD)
      .max(RECORD_COUNT)
      .openapi({
        description: `Best score this address has reached (${PASS_THRESHOLD}..${RECORD_COUNT}). Entries created before scores were tracked report ${RECORD_COUNT} (they passed under the old perfect-run rule).`,
      }),
  })
  .openapi('CompletedItem');

const CompletedResponseSchema = z
  .object({
    data: z.array(CompletedItemSchema),
    next_cursor: z
      .string()
      .nullable()
      .openapi({ description: 'Cursor for the next page, null if no more pages' }),
  })
  .openapi('CompletedResponse');

// --- routes ---

const getCompletedRoute = createRoute({
  method: 'get',
  path: '/api/completed',
  tags: ['Leaderboard'],
  summary: 'List addresses that have completed the challenge',
  description: `Paginated list of addresses that scored at least ${PASS_THRESHOLD}/${RECORD_COUNT}. Sorted newest first. Optionally filter by minimum score.`,
  security: [{ ApiKeyAuth: [] }],
  request: { query: CompletedQuerySchema },
  responses: {
    200: {
      content: { 'application/json': { schema: CompletedResponseSchema } },
      description: 'Paginated list of completed addresses',
    },
    400: {
      content: { 'application/json': { schema: ErrorResponseSchema } },
      description: 'Invalid cursor or min_score',
    },
    401: {
      content: { 'application/json': { schema: ErrorResponseSchema } },
      description: 'Missing or invalid API key',
    },
    500: {
      content: { 'application/json': { schema: ErrorResponseSchema } },
      description: 'Internal server error',
    },
  },
});

// --- app ---

const PAGE_SIZE = 100;

const apiKeyAuth = createMiddleware(async (c, next) => {
  const key = c.req.header('x-api-key');
  if (key !== env.API_KEY) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  await next();
});

export const app = new OpenAPIHono({
  defaultHook: (result, c) => {
    if (!result.success) {
      return c.json({ error: 'Bad Request', details: result.error.issues }, 400);
    }
  },
});

app.use('*', honoLogger());
app.use(
  '/api/*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['content-type', 'x-api-key'],
    maxAge: 600,
  }),
);

app.use('/api/completed', apiKeyAuth);

// Plain Hono route (not registered via `app.openapi`) so /api/submit stays
// out of the public OpenAPI doc — it's only consumed by the CLI.
app.post('/api/submit', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = SubmitRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Bad Request', details: parsed.error.issues }, 400);
  }
  const { message, signature, answers } = parsed.data;

  let parsedMsg;
  try {
    parsedMsg = parseSiweMessage(message);
  } catch {
    return c.json(
      { error: 'We could not read your wallet signature. Re-run the CLI and sign again.' },
      400,
    );
  }

  if (parsedMsg.expirationTime) {
    const exp = new Date(parsedMsg.expirationTime).getTime();
    if (!Number.isFinite(exp) || exp < Date.now()) {
      return c.json(
        {
          error:
            'Your wallet signature has expired (signatures are valid for ~10 minutes). Re-run the CLI to sign again.',
        },
        401,
      );
    }
  }

  let address: string;
  try {
    address = verifySiwePersonalSig(message, signature);
  } catch {
    return c.json(
      { error: 'We could not verify your wallet signature. Re-run the CLI and sign again.' },
      401,
    );
  }

  const expected = expectedVerdicts(getCorruptionMask(address));
  const score = scoreAnswers(expected, answers as AnswerVerdict[]);
  const passed = score >= PASS_THRESHOLD;

  if (passed) {
    // `$max` ensures a repeated attempt only raises the stored score; an
    // address that previously scored 5 can't be downgraded by later 3s.
    await CompletedAddress.updateOne(
      { address },
      { $max: { score }, $setOnInsert: { address } },
      { upsert: true },
    );
  }

  return c.json({ passed, score }, 200);
});

app.openapi(getCompletedRoute, async (c) => {
  try {
    const { cursor, min_score: minScore } = c.req.valid('query');
    const cursorId = cursor ? new Types.ObjectId(cursor) : undefined;

    // Documents written before the score field existed lack `score`; coerce
    // them to RECORD_COUNT (they passed under the old perfect-run rule) so
    // they're both filterable and reportable.
    const scoreCoerced = { $ifNull: ['$score', RECORD_COUNT] };

    const [result] = await CompletedAddress.aggregate([
      ...(cursorId ? [{ $match: { _id: { $lt: cursorId } } }] : []),
      { $addFields: { _score: scoreCoerced } },
      ...(minScore !== undefined ? [{ $match: { _score: { $gte: minScore } } }] : []),
      { $sort: { _id: -1 as const } },
      { $limit: PAGE_SIZE + 1 },
      {
        $facet: {
          data: [
            { $limit: PAGE_SIZE },
            {
              $project: {
                _id: 0,
                address: '$address',
                completed_at: { $dateToString: { date: '$createdAt' } },
                score: '$_score',
              },
            },
          ],
          next: [{ $skip: PAGE_SIZE }, { $limit: 1 }, { $project: { _id: 1 } }],
        },
      },
    ]);

    const nextCursor = result.next[0]?._id?.toHexString() ?? null;
    return c.json({ data: result.data, next_cursor: nextCursor }, 200);
  } catch {
    console.error('[http] GET /api/completed failed');
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});

// Plain liveness probe — not in the OpenAPI doc; only used by the
// docker-compose healthcheck.
app.get('/api/health', (c) => c.json({ status: 'ok' as const }, 200));

app.openAPIRegistry.registerComponent('securitySchemes', 'ApiKeyAuth', {
  type: 'apiKey',
  in: 'header',
  name: 'x-api-key',
});

const openApiDoc = {
  openapi: '3.1.0' as const,
  info: {
    title: 'Knidos Testnet Challenge — Leaderboard API',
    version: '1.0.0',
    description:
      'Authenticated read access to addresses that have completed the Knidos ZK testnet challenge. Intended for the Knidos team to pull the leaderboard. The CLI-facing grading endpoint is internal and not documented here.',
  },
};

app.doc31('/api/openapi', openApiDoc);
app.doc31('/api/openapi.json', openApiDoc);

app.get('/api/docs', swaggerUI({ url: './openapi' }));

try {
  await mongoose.connect(env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
  console.log('[server] connected to mongodb');
  serve({ fetch: app.fetch, port: env.PORT }, ({ port }) => {
    console.log(`[server] testnet-challange-api listening on :${port}`);
  });
} catch (error) {
  console.error('[server] fatal error', error);
  process.exit(1);
}
