import { Hono } from 'hono';
import { Types } from 'mongoose';

import { CompletedAddress } from '../db/completed-address.js';

const PAGE_SIZE = 100;

export const completedRoutes = new Hono();

completedRoutes.get('/api/completed', async (c) => {
  const cursor = c.req.query('cursor');
  let cursorId: Types.ObjectId | undefined;
  if (cursor) {
    if (!Types.ObjectId.isValid(cursor)) {
      return c.json({ error: 'invalid cursor' }, 400);
    }
    cursorId = new Types.ObjectId(cursor);
  }

  // `$facet` returns both the page and one extra row used as the next cursor
  // in a single round-trip — same pattern as zk-node's /api/verifications.
  const [result] = await CompletedAddress.aggregate([
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
              address: '$address',
              completed_at: { $dateToString: { date: '$createdAt' } },
            },
          },
        ],
        next: [{ $skip: PAGE_SIZE }, { $limit: 1 }, { $project: { _id: 1 } }],
      },
    },
  ]);

  const nextCursor = result.next[0]?._id?.toHexString() ?? null;
  return c.json({ data: result.data, next_cursor: nextCursor });
});
