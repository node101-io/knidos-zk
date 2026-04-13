import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { RedisStore, rateLimiter } from 'hono-rate-limiter';
import { Types } from 'mongoose';
import { z } from 'zod';

import VerificationRecord from './db/verification-record.js';
import { env } from './env.js';
import logger from './shared/logger.js';
import { redisRateLimitClient } from './shared/redis.js';

const PAGE_SIZE = 20;
const ZKVERIFY_EXPLORER_BASE = 'https://zkverify-testnet.subscan.io/extrinsic';

const cursorSchema = z
  .string()
  .optional()
  .transform((val) => {
    if (!val) return undefined;
    if (!Types.ObjectId.isValid(val)) throw new Error('Invalid cursor');
    return new Types.ObjectId(val);
  });

export const app = new Hono();

app.use(
  rateLimiter({
    windowMs: 60 * 1000,
    limit: 30,
    standardHeaders: 'draft-6',
    keyGenerator: (c) => c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown',
    store: new RedisStore({ client: redisRateLimitClient }),
    message: { error: 'Too Many Requests' },
  }),
);

app.get('/api/verifications', async (c) => {
  try {
    const parsed = cursorSchema.safeParse(c.req.query('cursor'));

    if (!parsed.success) {
      return c.json({ error: 'Bad Request', details: parsed.error.issues }, 400);
    }

    const [result] = await VerificationRecord.aggregate([
      ...(parsed.data ? [{ $match: { _id: { $lt: parsed.data } } }] : []),
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
                verification_key: '$vk',
                public_inputs: '$publicSignals',
              },
            },
          ],
          next: [{ $skip: PAGE_SIZE }, { $limit: 1 }, { $project: { _id: 1 } }],
        },
      },
    ]);

    const nextCursor = result.next[0]?._id?.toHexString() ?? null;

    return c.json({ data: result.data, next_cursor: nextCursor });
  } catch (error) {
    logger.error({ error }, '[http] GET /api/verifications failed');
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});

export function startHttpServer(): void {
  serve({ fetch: app.fetch, port: env.PORT }, () => {
    logger.info({ port: env.PORT }, '[http] server listening');
  });
}
