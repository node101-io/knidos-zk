import mongoose from 'mongoose';

import { Task, type TaskType } from '../db/task.js';
import { env } from '../env.js';

// Usage:
//   pnpm tasks:retry
//   pnpm tasks:retry --type=zkTLS
//   pnpm tasks:retry --type=zkTLS,noir
const ALLOWED_TYPES: TaskType[] = ['zkTLS', 'noir', 'zkVerify'];

function parseTypes(): TaskType[] {
  const raw = process.argv.find((arg) => arg.startsWith('--type='))?.slice('--type='.length);
  if (!raw) return ALLOWED_TYPES;

  const types = raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean) as TaskType[];

  const invalid = types.filter((type) => !ALLOWED_TYPES.includes(type));
  if (invalid.length > 0) {
    throw new Error(`Invalid task type: ${invalid.join(', ')}`);
  }

  return types;
}

async function main(): Promise<void> {
  const types = parseTypes();

  await mongoose.connect(env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });

  const result = await Task.updateMany(
    {
      type: { $in: types },
      status: 'FAILED',
    },
    {
      $set: {
        status: 'PENDING',
        error: {
          message: '[manual retry] task moved back to PENDING',
          retriedAt: new Date(),
        },
      },
      $unset: {
        finishedAt: 1,
      },
    },
  );

  console.log(`Retried ${result.modifiedCount} failed task(s) for type(s): ${types.join(', ')}`);
  await mongoose.disconnect();
}

await main();
