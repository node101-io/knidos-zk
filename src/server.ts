import { serve } from '@hono/node-server';
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { swaggerUI } from '@hono/swagger-ui';
import { createMiddleware } from 'hono/factory';
import mongoose from 'mongoose';
import { Types } from 'mongoose';

import VerificationRecord from './db/verification-record.js';
import { env } from './env.js';
import logger from './shared/logger.js';
import { redis } from './shared/redis.js';

// --- schemas ---

const CursorQuerySchema = z
  .object({
    cursor: z
      .string()
      .regex(/^[a-f\d]{24}$/i, 'Must be a valid 24-character hex ObjectId')
      .optional()
      .openapi({
        description: 'Pagination cursor (MongoDB ObjectId)',
        example: '507f1f77bcf86cd799439011',
      }),
  })
  .openapi('CursorQuery');

const VkPathParamsSchema = z
  .object({
    hash: z
      .string()
      .openapi({ description: 'SHA-256 hash of the verification key', example: 'abc123' }),
  })
  .openapi('VkPathParams');

const VerificationItemSchema = z
  .object({
    settlement_time: z.string().openapi({
      description: 'ISO 8601 settlement timestamp',
      example: '2026-01-01T00:00:00.000Z',
    }),
    tx_hash: z.string().openapi({ description: 'On-chain transaction hash' }),
    proof_url: z.string().url().openapi({ description: 'Link to zkVerify explorer' }),
    vk_hash: z.string().openapi({ description: 'SHA-256 hash of the verification key' }),
    public_inputs: z.array(z.string()).openapi({ description: 'Public signals for the proof' }),
  })
  .openapi('VerificationItem');

const VerificationsResponseSchema = z
  .object({
    data: z.array(VerificationItemSchema),
    next_cursor: z
      .string()
      .nullable()
      .openapi({ description: 'Cursor for the next page, null if no more pages' }),
  })
  .openapi('VerificationsResponse');

const VkResponseSchema = z
  .object({
    vk_hash: z.string().openapi({ description: 'SHA-256 hash of the verification key' }),
    verification_key: z.string().openapi({ description: 'The full verification key' }),
  })
  .openapi('VkResponse');

const ErrorResponseSchema = z
  .object({
    error: z.string().openapi({ description: 'Error message', example: 'Bad Request' }),
  })
  .openapi('ErrorResponse');

// --- routes ---

const getVerificationsRoute = createRoute({
  method: 'get',
  path: '/api/verifications',
  tags: ['Verifications'],
  summary: 'List verification records',
  description:
    'Returns a paginated list of zero-knowledge proof verifications settled on zkVerify.',
  security: [{ ApiKeyAuth: [] }],
  request: { query: CursorQuerySchema },
  responses: {
    200: {
      content: { 'application/json': { schema: VerificationsResponseSchema } },
      description: 'Paginated list of verifications',
    },
    400: {
      content: { 'application/json': { schema: ErrorResponseSchema } },
      description: 'Invalid cursor parameter',
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

const getVkRoute = createRoute({
  method: 'get',
  path: '/api/vk/{hash}',
  tags: ['Verification Keys'],
  summary: 'Get verification key by hash',
  description:
    'Retrieves a verification key by its SHA-256 hash. Responses are cached with immutable headers for one year.',
  security: [{ ApiKeyAuth: [] }],
  request: { params: VkPathParamsSchema },
  responses: {
    200: {
      content: { 'application/json': { schema: VkResponseSchema } },
      description: 'Verification key found',
    },
    401: {
      content: { 'application/json': { schema: ErrorResponseSchema } },
      description: 'Missing or invalid API key',
    },
    404: {
      content: { 'application/json': { schema: ErrorResponseSchema } },
      description: 'Verification key not found',
    },
    500: {
      content: { 'application/json': { schema: ErrorResponseSchema } },
      description: 'Internal server error',
    },
  },
});

// --- app ---

const PAGE_SIZE = 20;
const ZKVERIFY_EXPLORER_BASE = 'https://zkverify-testnet.subscan.io/extrinsic';
const VK_CACHE_PREFIX = 'vk:';

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

app.use('/api/verifications', apiKeyAuth);
app.use('/api/vk/*', apiKeyAuth);

app.openapi(getVerificationsRoute, async (c) => {
  try {
    const { cursor } = c.req.valid('query');
    const cursorId = cursor ? new Types.ObjectId(cursor) : undefined;

    const [result] = await VerificationRecord.aggregate([
      ...(cursorId ? [{ $match: { _id: { $lt: cursorId } } }] : []),
      { $sort: { _id: -1 as const } },
      { $limit: PAGE_SIZE + 1 },
      {
        $facet: {
          data: [
            { $limit: PAGE_SIZE },
            {
              $project: {
                _id: 0,
                settlement_time: { $dateToString: { date: '$createdAt' } },
                tx_hash: '$includedInBlock.txHash',
                proof_url: { $concat: [ZKVERIFY_EXPLORER_BASE, '/', '$includedInBlock.txHash'] },
                vk_hash: '$vkHash',
                public_inputs: '$publicSignals',
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
    logger.error('[http] GET /api/verifications failed');
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});

app.openapi(getVkRoute, async (c) => {
  try {
    const { hash } = c.req.valid('param');

    const cached = await redis.get(`${VK_CACHE_PREFIX}${hash}`);
    if (cached) {
      c.header('Cache-Control', 'no-store');
      c.header('CDN-Cache-Control', 'public, max-age=31536000, immutable');
      return c.json({ vk_hash: hash, verification_key: cached }, 200);
    }

    const record = await VerificationRecord.findOne({ vkHash: hash }, { vk: 1, vkHash: 1 });
    if (!record) {
      return c.json({ error: 'Not Found' }, 404);
    }

    await redis.set(`${VK_CACHE_PREFIX}${hash}`, record.vk);

    c.header('Cache-Control', 'public, max-age=31536000, immutable');
    return c.json({ vk_hash: hash, verification_key: record.vk }, 200);
  } catch {
    logger.error('[http] GET /api/vk/:hash failed');
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});

app.openAPIRegistry.registerComponent('securitySchemes', 'ApiKeyAuth', {
  type: 'apiKey',
  in: 'header',
  name: 'x-api-key',
});

const openApiDoc = {
  openapi: '3.1.0',
  info: {
    title: 'Knidos ZK Verification API',
    version: '1.0.0',
    description: 'API for querying zero-knowledge proof verifications settled on zkVerify.',
  },
};

app.doc('/api/openapi', openApiDoc);
app.doc('/api/openapi.json', openApiDoc);

app.get('/api/docs', swaggerUI({ url: '/api/openapi' }));

try {
  await mongoose.connect(env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
  logger.info('[server] connected to mongodb');
  serve({ fetch: app.fetch, port: env.PORT }, () => {
    logger.info({ port: env.PORT }, '[server] listening');
  });
} catch (error) {
  logger.error({ error }, '[server] fatal error');
  process.exit(1);
}
