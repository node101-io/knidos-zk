import mongoose from 'mongoose';

import { env } from '../env.js';
import { getDeferredTasks, getQueueStatus } from '../services/queue-status.js';

await mongoose.connect(env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });

const status = await getQueueStatus();
const renamed = Object.fromEntries(
  Object.entries(status).map(([type, counts]) => {
    const { SUCCESS, ...rest } = counts;
    return [type, { ...rest, 'SUCCESS (last 1h)': SUCCESS ?? 0 }];
  }),
);

console.table(renamed);
console.table(await getDeferredTasks());

await mongoose.disconnect();
process.exit(0);
