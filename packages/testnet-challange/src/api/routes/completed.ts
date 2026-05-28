import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { Types } from 'mongoose';

import { PASS_THRESHOLD, RECORD_COUNT } from '../../types.js';
import { CompletedAddress } from '../db/completed-address.js';
import { errorResponse, validationHook } from '../lib/openapi.js';

const PAGE_SIZE = 100;

const completedEntrySchema = z
  .object({
    address: z.string().regex(/^0x[0-9a-f]{40}$/).openapi({
      description: 'Lower-cased Ethereum address that completed the challenge.',
      example: '0x1234567890abcdef1234567890abcdef12345678',
    }),
    completed_at: z.string().openapi({
      description: 'ISO timestamp of when this address first cleared the threshold.',
      example: '2026-05-29T12:34:56.789Z',
    }),
    score: z
      .number()
      .int()
      .min(PASS_THRESHOLD)
      .max(RECORD_COUNT)
      .openapi({
        description: `Best score this address has reached (${PASS_THRESHOLD}..${RECORD_COUNT}). Entries created before scores were tracked report ${RECORD_COUNT} (they passed under the old "perfect run" rule).`,
      }),
  })
  .openapi('CompletedEntry');

const completedResponseSchema = z
  .object({
    data: z.array(completedEntrySchema),
    next_cursor: z
      .string()
      .nullable()
      .openapi({
        description:
          'Opaque cursor for the next page, or null at the end. Pass back as the `cursor` query param.',
      }),
  })
  .openapi('CompletedListResponse');

const completedQuerySchema = z.object({
  cursor: z
    .string()
    .optional()
    .openapi({
      param: { name: 'cursor', in: 'query' },
      description: 'Opaque cursor from the previous response\'s `next_cursor`.',
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

const completedRoute = createRoute({
  method: 'get',
  path: '/api/completed',
  tags: ['challenge'],
  summary: 'List addresses that have completed the challenge',
  description: `Paginated list of addresses that scored at least ${PASS_THRESHOLD}/${RECORD_COUNT}. Sorted newest first. Optionally filter by minimum score.`,
  request: { query: completedQuerySchema },
  responses: {
    200: {
      description: 'A page of completed addresses.',
      content: { 'application/json': { schema: completedResponseSchema } },
    },
    400: errorResponse('Invalid cursor or min_score.'),
  },
});

export const completedRoutes = new OpenAPIHono({ defaultHook: validationHook });

completedRoutes.openapi(completedRoute, async (c) => {
  const { cursor, min_score: minScore } = c.req.valid('query');

  let cursorId: Types.ObjectId | undefined;
  if (cursor) {
    if (!Types.ObjectId.isValid(cursor)) {
      return c.json({ error: 'invalid cursor' }, 400);
    }
    cursorId = new Types.ObjectId(cursor);
  }

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
});
