import mongoose from 'mongoose';

import { Task, type TaskType } from '../db/task.js';
import { env } from '../env.js';

// Usage:
//   pnpm tasks:failures
//   pnpm tasks:failures --type=zkTLS
//   pnpm tasks:failures --type=zkTLS,noir
//   pnpm tasks:failures --since=24h        # last 24 hours
//   pnpm tasks:failures --since=7d         # last 7 days
//   pnpm tasks:failures --limit=10         # top 10 reasons only

const ALLOWED_TYPES: TaskType[] = ['zkTLS', 'noir', 'zkVerify'];

function flag(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function parseTypes(): TaskType[] {
  const raw = flag('type');
  if (!raw) return ALLOWED_TYPES;
  const types = raw.split(',').map((v) => v.trim()).filter(Boolean) as TaskType[];
  const invalid = types.filter((t) => !ALLOWED_TYPES.includes(t));
  if (invalid.length > 0) throw new Error(`Invalid task type: ${invalid.join(', ')}`);
  return types;
}

// "24h", "7d", "30m" → ms; falsy if absent.
function parseSinceMs(): number | undefined {
  const raw = flag('since');
  if (!raw) return undefined;
  const match = /^(\d+)([smhd])$/.exec(raw);
  if (!match) throw new Error(`Invalid --since (use e.g. 30m, 24h, 7d): ${raw}`);
  const n = Number(match[1]);
  const unit = match[2];
  const mul = unit === 's' ? 1_000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
  return n * mul;
}

function parseLimit(): number | undefined {
  const raw = flag('limit');
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`Invalid --limit: ${raw}`);
  return n;
}

interface ReasonGroup {
  _id: string;
  count: number;
  byType: { type: TaskType; count: number }[];
  sampleId: string;
  lastSeen: Date;
}

async function main(): Promise<void> {
  const types = parseTypes();
  const sinceMs = parseSinceMs();
  const limit = parseLimit();

  await mongoose.connect(env.MONGO_URI, { serverSelectionTimeoutMS: 5_000 });
  try {
    const match: Record<string, unknown> = {
      type: { $in: types },
      status: 'FAILED',
    };
    if (sinceMs !== undefined) {
      const sinceDate = new Date(Date.now() - sinceMs);
      // ObjectId's first 4 bytes are the creation timestamp (Unix seconds);
      // pack our cutoff into a synthetic ObjectId so this stays index-backed
      // even when finishedAt is null (which is common — retries unset it).
      const sinceOid = mongoose.Types.ObjectId.createFromTime(
        Math.floor(sinceDate.getTime() / 1000),
      );
      match.$or = [{ finishedAt: { $gte: sinceDate } }, { _id: { $gte: sinceOid } }];
    }

    const pipeline: mongoose.PipelineStage[] = [
      { $match: match },
      // Normalize the heterogeneous `error` field down to a single string.
      // Common shapes seen: { message: '...' } (most), '...' (string), or
      // null/undefined. Fall back to '<no reason>' when nothing is set.
      {
        $addFields: {
          reason: {
            $let: {
              vars: { t: { $type: '$error' } },
              in: {
                $cond: [
                  { $eq: ['$$t', 'string'] },
                  '$error',
                  {
                    $cond: [
                      { $eq: ['$$t', 'object'] },
                      { $ifNull: ['$error.message', '<error: object with no message>'] },
                      '<no reason>',
                    ],
                  },
                ],
              },
            },
          },
        },
      },
      {
        $group: {
          _id: '$reason',
          count: { $sum: 1 },
          types: { $push: '$type' },
          sampleId: { $first: '$_id' },
          // finishedAt is unset on retries and on tasks that crashed before
          // marking themselves finished — fall back to the ObjectId's embedded
          // creation timestamp so we always have *something* meaningful.
          lastSeen: { $max: { $ifNull: ['$finishedAt', { $toDate: '$_id' }] } },
        },
      },
      { $sort: { count: -1 } },
    ];
    if (limit !== undefined) pipeline.push({ $limit: limit });

    const raw = (await Task.aggregate(pipeline)) as {
      _id: string;
      count: number;
      types: TaskType[];
      sampleId: mongoose.Types.ObjectId;
      lastSeen: Date | null;
    }[];

    if (raw.length === 0) {
      const range = sinceMs ? ` in the last ${flag('since')}` : '';
      console.log(`no FAILED tasks${range} for type(s): ${types.join(', ')}`);
      return;
    }

    const groups: ReasonGroup[] = raw.map((row) => {
      const byTypeMap = new Map<TaskType, number>();
      for (const t of row.types) byTypeMap.set(t, (byTypeMap.get(t) ?? 0) + 1);
      return {
        _id: row._id,
        count: row.count,
        byType: [...byTypeMap.entries()]
          .map(([type, count]) => ({ type, count }))
          .sort((a, b) => b.count - a.count),
        sampleId: row.sampleId.toHexString(),
        lastSeen: row.lastSeen ?? new Date(0),
      };
    });

    const total = groups.reduce((s, g) => s + g.count, 0);
    const range = sinceMs ? `last ${flag('since')}` : 'all time';
    console.log(
      `Failed tasks (${range}, type=${types.join(',')}): ${total} across ${groups.length} reason(s)\n`,
    );

    for (const g of groups) {
      const pct = ((g.count / total) * 100).toFixed(1);
      const byType = g.byType.map(({ type, count }) => `${type}=${count}`).join(' ');
      console.log(`  [${g.count.toString().padStart(5)} | ${pct.padStart(5)}%] ${g._id}`);
      console.log(`           ${byType}   last: ${g.lastSeen.toISOString()}   sample: ${g.sampleId}`);
    }
  } finally {
    await mongoose.disconnect();
  }
}

await main();
