import { Queue, type Job } from 'bullmq';
import mongoose from 'mongoose';

import Task from '../../db/task.js';
import { redis } from '../../shared/redis.js';
import logger from '../../shared/logger.js';
import type { ZkTLSJobData } from '../types.js';
import { parseZkTLSJobInput } from '../validation.js';
import { runZkTLSProcessor } from './processor.js';

export const zkTLSQueue = new Queue('zkTLS-queue', { connection: redis });

export async function processZkTLSJob(
  workerId: number,
  job: Job<ZkTLSJobData, void>,
): Promise<void> {
  const { taskId, input } = job.data;

  const task = await Task.findById(taskId);
  if (!task) {
    logger.warn({ taskId, jobId: job.id }, '[zkTLS worker] task not found');
    return;
  }

  if (task.status === 'COMPLETED') return;

  if (task.status === 'FAILED' && task.attemptCount >= task.maxAttempt) return;

  if (task.status === 'RUNNING') return;

  try {
    const parsedInput = parseZkTLSJobInput(input);

    await Task.updateTaskStatus({
      taskId,
      status: 'RUNNING',
    });

    const result = await runZkTLSProcessor(parsedInput);

    const session = await mongoose.startSession();

    try {
      await session.withTransaction(async () => {
        await Task.updateTaskStatus(
          {
            taskId,
            status: 'COMPLETED',
          },
          { session },
        );

        await Task.createTask(
          {
            type: 'noir',
            pipelineId: task.pipelineId,
            input: {
              zkTLSTaskId: taskId,
              circuitInput: result,
            },
          },
          { session },
        );
      });
    } finally {
      await session.endSession();
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    await Task.updateTaskStatus({
      taskId,
      status: 'FAILED',
      error: errorMessage,
    });

    throw error;
  }
}
