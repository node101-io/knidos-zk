import Task from '../db/task.js';

const PIPELINE_ORDER = ['zkTLS', 'noir', 'zkVerify'] as const;

export type QueueStatusResult = Record<string, Record<string, number>>;

export async function getQueueStatus(): Promise<QueueStatusResult> {
  const results = await Task.aggregate([
    { $group: { _id: { type: '$type', status: '$status' }, count: { $sum: 1 } } },
    { $sort: { '_id.type': 1, '_id.status': 1 } },
  ]);

  const counts: Record<string, Record<string, number>> = {};

  for (const row of results) {
    const type = row._id.type as string;
    const status = row._id.status as string;
    counts[type] ??= {};
    if (status === 'COMPLETED') continue;
    counts[type][status] = row.count as number;
  }

  const table: QueueStatusResult = {};

  for (const type of PIPELINE_ORDER) {
    table[type] = { PENDING: 0, QUEUED: 0, RUNNING: 0, FAILED: 0, ...counts[type] };
  }

  return table;
}
