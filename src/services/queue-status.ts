import Task from '../db/task.js';

const PIPELINE_ORDER = ['zkTLS', 'noir', 'zkVerify'] as const;

export type QueueStatusResult = Record<string, Record<string, number>>;
export interface DeferredTaskResult {
  taskId: string;
  type: string;
  symbol: string | null;
  endTime: Date | null;
  deferReason: string | null;
  deferUntil: Date | null;
}

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
    table[type] = { PENDING: 0, QUEUED: 0, RUNNING: 0, DEFERRED: 0, FAILED: 0, ...counts[type] };
  }

  return table;
}

export async function getDeferredTasks(limit = 20): Promise<DeferredTaskResult[]> {
  const tasks = await Task.find(
    { status: 'DEFERRED' },
    {
      type: 1,
      deferReason: 1,
      deferUntil: 1,
      'input.symbol': 1,
      'input.endTime': 1,
    },
  )
    .sort({ deferUntil: 1, 'input.endTime': 1, _id: 1 })
    .limit(limit)
    .lean();

  return tasks.map((task) => {
    const input = task.input as { symbol?: unknown; endTime?: unknown };
    return {
      taskId: task._id.toString(),
      type: task.type,
      symbol: typeof input.symbol === 'string' ? input.symbol : null,
      endTime: input.endTime instanceof Date ? input.endTime : null,
      deferReason: typeof task.deferReason === 'string' ? task.deferReason : null,
      deferUntil: task.deferUntil instanceof Date ? task.deferUntil : null,
    };
  });
}
