import mongoose from 'mongoose';

import Task from '../db/task.js';
import { env } from '../env.js';
import { noirQueue } from '../pipelines/noir/worker.js';
import { zkTLSQueue } from '../pipelines/zk-tls/worker.js';
import { zkVerifyQueue } from '../pipelines/zk-verify/worker.js';

const queues = [
  { name: 'zkTLS', queue: zkTLSQueue },
  { name: 'noir', queue: noirQueue },
  { name: 'zkVerify', queue: zkVerifyQueue },
];

await mongoose.connect(env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });

console.log('\n=== BullMQ Queues ===\n');

const bullmqTable: Record<string, { waiting: number; active: number; delayed: number; failed: number }> = {};

for (const { name, queue } of queues) {
  const [waiting, active, delayed, failed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getDelayedCount(),
    queue.getFailedCount(),
  ]);

  bullmqTable[name] = { waiting, active, delayed, failed };
}

console.table(bullmqTable);

console.log('\n=== MongoDB Tasks ===\n');

const results = await Task.aggregate([
  { $group: { _id: { type: '$type', status: '$status' }, count: { $sum: 1 } } },
  { $sort: { '_id.type': 1, '_id.status': 1 } },
]);

const mongoTable: Record<string, Record<string, number>> = {};

for (const row of results) {
  const type = row._id.type as string;
  const status = row._id.status as string;
  mongoTable[type] ??= { PENDING: 0, QUEUED: 0, RUNNING: 0, FAILED: 0 };
  if (status === 'COMPLETED') continue;
  mongoTable[type][status] = row.count as number;
}

console.table(mongoTable);

await mongoose.disconnect();
process.exit(0);
