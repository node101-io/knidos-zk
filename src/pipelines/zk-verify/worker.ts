import { Queue, type Job } from 'bullmq';
import mongoose from 'mongoose';

import Task from '../../db/task.js';
import VerificationRecord from '../../db/verification-record.js';
import { redis } from '../../shared/redis.js';
import logger from '../../shared/logger.js';
import type { ZkVerifyJobData } from '../types.js';
import type { NoirProcessorResult } from '../noir/processor.js';
import { parseZkVerifyJobInput } from '../validation.js';
import { runZkVerifyProcessor } from './processor.js';

export const zkVerifyQueue = new Queue('zkVerify-queue', { connection: redis });

const ZKVERIFY_MIN_GAP_MS = 15 * 1000;
const ZKVERIFY_SLEEP_STEP_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function processZkVerifyJob(
  workerId: number,
  job: Job<ZkVerifyJobData, void>,
): Promise<void> {
  const { taskId, input } = job.data;

  const task = await Task.findById(taskId);
  if (!task) {
    logger.warn({ taskId, jobId: job.id }, '[zkVerify worker] task not found');
    return;
  }

  if (task.status === 'COMPLETED') return;

  if (task.status === 'FAILED' && task.attemptCount >= task.maxAttempt) return;

  if (task.status === 'RUNNING') return;

  try {
    const parsedInput = parseZkVerifyJobInput(input);

    await Task.updateTaskStatus({
      taskId,
      status: 'RUNNING',
    });

    for (;;) {
      const previousCompletedTask = await Task.findOne({
        type: 'zkVerify',
        status: 'COMPLETED',
        _id: { $ne: taskId },
      }).sort({ finishedAt: -1 });

      if (!previousCompletedTask?.finishedAt) {
        break;
      }

      const elapsedMs = Date.now() - new Date(previousCompletedTask.finishedAt).getTime();

      if (elapsedMs >= ZKVERIFY_MIN_GAP_MS) {
        break;
      }

      const remainingMs = ZKVERIFY_MIN_GAP_MS - elapsedMs;

      logger.info(
        {
          taskId,
          workerId,
          previousTaskId: previousCompletedTask._id,
          remainingMs,
        },
        '[zkVerify worker] waiting before next zkVerify submission',
      );

      await sleep(Math.min(ZKVERIFY_SLEEP_STEP_MS, remainingMs));
    }

    logger.info(
      { taskId, workerId, noirTaskId: parsedInput.noirTaskId },
      '[zkVerify worker] starting zkVerify task',
    );

    const noirTask = await Task.findById(parsedInput.noirTaskId);
    if (!noirTask) {
      throw new Error(`[zkVerify worker] referenced noir task not found: ${parsedInput.noirTaskId}`);
    }

    const noirResult = noirTask.result as NoirProcessorResult | null | undefined;
    if (!noirResult) {
      throw new Error(
        `[zkVerify worker] noir task ${parsedInput.noirTaskId} has no proof artifacts on result`,
      );
    }

    const result = await runZkVerifyProcessor({
      vk: noirResult.vkHex,
      proof: noirResult.proofHex,
      publicSignals: noirResult.publicInputs,
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

        await VerificationRecord.create(
          [
            {
              pipelineId: task.pipelineId,
              zkVerifyTaskId: task._id,
              noirTaskId: new mongoose.Types.ObjectId(parsedInput.noirTaskId),

              variant: result.variant,

              vk: result.vk,
              proof: result.proof,
              publicSignals: result.publicSignals,

              ...(result.statement !== undefined ? { statement: result.statement } : {}),
              ...(result.aggregationId !== undefined
                ? { aggregationId: result.aggregationId }
                : {}),
              ...(result.includedInBlock !== undefined
                ? { includedInBlock: result.includedInBlock }
                : {}),
            },
          ],
          { session },
        );
      });
    } finally {
      await session.endSession();
    }

    logger.info(
      { taskId, workerId, aggregationId: result.aggregationId },
      '[zkVerify worker] completed zkVerify task',
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    const isRetryableTxPoolError =
      errorMessage.includes('Priority is too low') ||
      errorMessage.includes('transaction already in the pool') ||
      errorMessage.includes('nonce') ||
      errorMessage.includes('replace another transaction already in the pool');

    const freshTask = await Task.findById(taskId);

    if (!freshTask) {
      logger.error(
        { taskId, workerId },
        '[zkVerify worker] task disappeared during error handling',
      );
      throw error;
    }

    if (isRetryableTxPoolError && freshTask.attemptCount < freshTask.maxAttempt) {
      await Task.updateTaskStatus({
        taskId,
        status: 'PENDING',
        error: errorMessage,
      });

      logger.warn(
        {
          taskId,
          workerId,
          error: errorMessage,
          attemptCount: freshTask.attemptCount,
          maxAttempt: freshTask.maxAttempt,
        },
        '[zkVerify worker] retryable tx pool error, task returned to PENDING',
      );
      return;
    }

    await Task.updateTaskStatus({
      taskId,
      status: 'FAILED',
      error: errorMessage,
    });

    logger.error(
      { taskId, workerId, error: errorMessage },
      '[zkVerify worker] failed zkVerify task',
    );
  }
}
