import type { Job } from 'bullmq';
import mongoose from 'mongoose';
import path from 'path';
import Task from '../db/models/Task.js';
import logger from '../logger.js';
import { runZkTLSProcessor } from '../processors/zkTLS.js';
import type { ZkTLSJobData } from '../types.js';

const ZKTLS_STALE_MS = 5 * 60 * 1000;

export async function processZkTLSJob(
  workerId: number,
  job: Job<ZkTLSJobData, void, string>,
): Promise<void> {
  const { taskId, input } = job.data;

  const task = await Task.findById(taskId);
  if (!task) {
    logger.warn({ taskId, jobId: job.id }, '[zkTLS worker] task not found');
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

    const result = await runZkTLSProcessor(input);

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

        const baseDir = path.resolve(process.cwd(), 'circuit-runs');
        const taskNoirDir = path.join(baseDir, task.pipelineId.toString());

        await Task.create(
          [
            {
              type: 'noir',
              pipelineId: task.pipelineId,
              input: {
                zkTLSTaskId: taskId,
                circuitInput: result,
                noirCircuitDir: taskNoirDir,
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
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    await Task.updateOne({ _id: taskId }, { status: 'FAILED', error: errorMessage });

    throw error;
  }
}
