import { Task } from '../db/task.js';

const PIPELINE_ORDER = ['zkTLS', 'noir', 'zkVerify'] as const;

export const SUCCESS_WINDOW_MS = 60 * 60 * 1000;

export type QueueStatusResult = Record<string, Record<string, number>>;
export interface DeferredTaskResult {
  taskId: string;
  type: string;
  endTime: Date | null;
  deferReason: string | null;
  deferUntil: Date | null;
}

export async function getQueueStatus(
  successWindowMs = SUCCESS_WINDOW_MS,
): Promise<QueueStatusResult> {
  const since = new Date(Date.now() - successWindowMs);

  const [statusRows, successRows, settleRows] = await Promise.all([
    Task.aggregate([
      { $match: { status: { $ne: 'COMPLETED' } } },
      { $group: { _id: { type: '$type', status: '$status' }, count: { $sum: 1 } } },
    ]),
    Task.aggregate([
      { $match: { status: 'COMPLETED', finishedAt: { $gte: since } } },
      { $group: { _id: '$type', count: { $sum: 1 } } },
    ]),
    // Within DEFERRED, how many are the scheduler's normal-flow settle wait
    // (await_window_settle) vs. something the operator needs to investigate.
    Task.aggregate([
      { $match: { status: 'DEFERRED', deferReason: 'await_window_settle' } },
      { $group: { _id: '$type', count: { $sum: 1 } } },
    ]),
  ]);

  const counts: Record<string, Record<string, number>> = {};

  for (const row of statusRows) {
    const type = row._id.type as string;
    const status = row._id.status as string;
    counts[type] ??= {};
    counts[type][status] = row.count as number;
  }

  for (const row of successRows) {
    const type = row._id as string;
    counts[type] ??= {};
    counts[type].SUCCESS = row.count as number;
  }

  for (const row of settleRows) {
    const type = row._id as string;
    counts[type] ??= {};
    counts[type].DEFERRED_SETTLE = row.count as number;
  }

  const table: QueueStatusResult = {};

  for (const type of PIPELINE_ORDER) {
    table[type] = {
      PENDING: 0,
      QUEUED: 0,
      RUNNING: 0,
      DEFERRED: 0,
      DEFERRED_SETTLE: 0,
      FAILED: 0,
      SUCCESS: 0,
      ...counts[type],
    };
  }

  return table;
}

export async function getDeferredTasks(limit = 20): Promise<DeferredTaskResult[]> {
  const tasks = await Task.find(
    {
      status: 'DEFERRED',
      // 'await_window_settle' is the scheduler's normal-flow defer — every
      // freshly-scheduled zkTLS task spends ~5 minutes here before the
      // master picks it up. Hide them from the status page so operators
      // only see actually-stuck tasks (rate limits, transient errors).
      deferReason: { $ne: 'await_window_settle' },
    },
    {
      type: 1,
      deferReason: 1,
      deferUntil: 1,
      'input.endTime': 1,
    },
  )
    .sort({ deferUntil: 1, 'input.endTime': 1, _id: 1 })
    .limit(limit)
    .lean();

  return tasks.map((task) => {
    const input = task.input as { endTime?: unknown };
    return {
      taskId: task._id.toString(),
      type: task.type,
      endTime: input.endTime instanceof Date ? input.endTime : null,
      deferReason: typeof task.deferReason === 'string' ? task.deferReason : null,
      deferUntil: task.deferUntil instanceof Date ? task.deferUntil : null,
    };
  });
}
