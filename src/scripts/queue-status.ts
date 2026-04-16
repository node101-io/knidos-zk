import mongoose from 'mongoose';

import { env } from '../env.js';
import { getQueueStatus } from '../services/queue-status.js';

await mongoose.connect(env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });

console.table(await getQueueStatus());

await mongoose.disconnect();
process.exit(0);
