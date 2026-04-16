import mongoose from 'mongoose';

import Task from '../db/task.js';
import { env } from '../env.js';

await mongoose.connect(env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });

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

const pipelineOrder = ['zkTLS', 'noir', 'zkVerify'] as const;
const table: Record<string, Record<string, number>> = {};

for (const type of pipelineOrder) {
  table[type] = { PENDING: 0, QUEUED: 0, RUNNING: 0, FAILED: 0, ...counts[type] };
}

console.table(table);

await mongoose.disconnect();
process.exit(0);
