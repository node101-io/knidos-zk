import { Queue, type Job } from 'bullmq';
import mongoose from 'mongoose';

import Task from '../../db/task.js';
import { redis } from '../../shared/redis.js';
import logger from '../../shared/logger.js';
import type { NoirJobData } from '../types.js';
import { parseNoirJobInput } from '../validation.js';
import { runNoirProcessor } from './processor.js';

export const noirQueue = new Queue('noir-queue', { connection: redis });

export async function processNoirJob(workerId: number, job: Job<NoirJobData, void>): Promise<void> {
  const { taskId, input } = job.data;

  const task = await Task.findById(taskId);
  if (!task) {
    logger.warn({ taskId, jobId: job.id }, '[noir worker] task not found');
    return;
  }

  if (task.status === 'COMPLETED') return;

  if (task.status === 'RUNNING') return;

  const parsedInput = parseNoirJobInput(input);

  await Task.updateTaskStatus({
    taskId,
    status: 'RUNNING',
  });

  logger.info({ taskId, workerId }, '[noir worker] starting noir task');

  const result = await runNoirProcessor(workerId, parsedInput);

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

      await Task.createTask(
        {
          type: 'zkVerify',
          pipelineId: task.pipelineId,
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

  logger.info({ taskId, workerId }, '[noir worker] completed noir task');

  logger.info({ taskId, workerId }, '[noir worker] created zkVerify task');
}
