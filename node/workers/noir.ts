import { Queue, type Job } from 'bullmq';
import mongoose from 'mongoose';

import { redis } from '../shared/redis.js';
import Task from '../db/task.js';
import logger from '../shared/logger.js';
import type { NoirJobData } from '../shared/types.js';
import { runNoirProcessor } from '../processors/noir.js';
import { pipeline } from 'node:stream';

export const noirQueue = new Queue('noir-queue', { connection: redis });

const NOIR_STALE_MS = 15 * 60 * 1000;

export async function processNoirJob(
  workerId: number,
  job: Job<NoirJobData, void, string>,
): Promise<void> {
  const { taskId, input } = job.data;

  const task = await Task.findById(taskId);
  if (!task) {
    logger.warn({ taskId, jobId: job.id }, '[noir worker] task not found');
    return;
  }

  const now = Date.now();

  if (task.status === 'COMPLETED') return;

  if (task.status === 'FAILED' && task.attemptCount >= task.maxAttempt) return;

  if (task.status === 'RUNNING') return;

  try {
    await Task.updateTaskStatus({
      taskId,
      status: 'RUNNING',
    });

    logger.info(
      { taskId, workerId, noirProjectDir: input.noirCircuitDir },
      '[noir worker] starting noir task',
    );

    const result = await runNoirProcessor(input);

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

        await Task.create(
          [
            {
              type: 'zkVerify',
              pipelineId: task.pipelineId,
              input: {
                noirTaskId: taskId,
                targetDir: result.targetDir,
              },
              status: 'PENDING',
            },
          ],
          { session },
        );
      });
    } finally {
      await session.endSession();
    }

    logger.info({ taskId, workerId }, '[noir worker] completed noir task');

    logger.info({ taskId, workerId }, '[noir worker] created zkVerify task');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    await Task.updateTaskStatus({
      taskId,
      status: 'FAILED',
      error: errorMessage,
    });

    logger.error(
      { taskId, workerId, pipelineId: task.pipelineId, error: errorMessage },
      '[noir worker] failed noir task',
    );

    throw error;
  }
}
