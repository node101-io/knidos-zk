import { Queue, type Job } from 'bullmq';
import mongoose from 'mongoose';

import Task from '../../db/task.js';
import { redis } from '../../shared/redis.js';
import type { TaskEventCtx } from '../../shared/task-event.js';
import type { NoirJobData } from '../types.js';
import { parseNoirJobInput } from '../validation.js';
import { runNoirProcessor } from './processor.js';

export const noirQueue = new Queue('noir-queue', { connection: redis });

export async function processNoirJob(
  workerId: number,
  job: Job<NoirJobData, void>,
  ctx: TaskEventCtx,
): Promise<void> {
  const { taskId, input } = job.data;
  ctx.set({ type: 'noir' });

  const task = await Task.findById(taskId);
  if (!task) {
    ctx.set({ outcome: 'skipped', skipReason: 'task_not_found' });
    return;
  }

  if (task.status === 'COMPLETED' || task.status === 'RUNNING') {
    ctx.set({ outcome: 'skipped', skipReason: 'already_completed_or_running' });
    return;
  }

  const parsedInput = parseNoirJobInput(input);
  ctx.set({
    symbol: parsedInput.symbol,
    windowStart: parsedInput.startTime,
    windowEnd: parsedInput.endTime,
    zkTLSTaskId: parsedInput.zkTLSTaskId,
  });

  await Task.updateTaskStatus({ taskId, status: 'RUNNING' });

  const stopProof = ctx.timer('proofGen');
  const result = await runNoirProcessor(workerId, parsedInput);
  stopProof();

  ctx.set({
    proofBytes: Math.floor((result.proofHex.length - 2) / 2),
    publicInputsCount: result.publicInputs.length,
    vkHashPrefix: result.vkHex.slice(0, 10),
  });

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await Task.updateTaskStatus(
        {
          taskId,
          status: 'COMPLETED',
          result,
        },
        { session },
      );

      await Task.updateOne(
        { _id: taskId },
        { $unset: { 'input.circuitInput': '' } },
        { session },
      );

      await Task.createTask(
        {
          type: 'zkVerify',
          input: {
            noirTaskId: taskId,
            symbol: parsedInput.symbol,
            startTime: parsedInput.startTime,
            endTime: parsedInput.endTime,
          },
        },
        { session },
      );
    });
  } finally {
    await session.endSession();
  }
}
