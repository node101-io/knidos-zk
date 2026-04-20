import { Queue, type Job } from 'bullmq';
import mongoose from 'mongoose';

import Task from '../../db/task.js';
import { redis } from '../../shared/redis.js';
import logger from '../../shared/logger.js';
import { serializeError } from '../../utils/error.js';
import { decideZkTLSError } from '../../primus/errors.js';
import type { ZkTLSJobData } from '../types.js';
import { parseZkTLSJobInput } from '../validation.js';
import { runZkTLSProcessor } from './processor.js';

export const zkTLSQueue = new Queue('zkTLS-queue', { connection: redis });

type TaskRecord = { _id: { toString(): string }; deferCount?: number | null };

type Outcome =
  | { kind: 'defer'; reason: string; deferUntil: Date; error: unknown }
  | { kind: 'fail'; error: unknown };

async function recordOutcome(task: TaskRecord, outcome: Outcome): Promise<void> {
  const taskId = task._id.toString();
  if (outcome.kind === 'defer') {
    await Task.updateTaskStatus({
      taskId,
      status: 'DEFERRED',
      error: serializeError(outcome.error),
      deferReason: outcome.reason,
      deferUntil: outcome.deferUntil,
      deferCount: (task.deferCount ?? 0) + 1,
    });
    logger.warn(
      { taskId, deferReason: outcome.reason, deferUntil: outcome.deferUntil },
      '[zkTLS worker] task deferred',
    );
    return;
  }
  await Task.updateTaskStatus({
    taskId,
    status: 'FAILED',
    error: serializeError(outcome.error),
  });
  logger.error({ taskId, error: outcome.error }, '[zkTLS worker] task failed');
}

export async function processZkTLSJob(
  _workerId: number,
  job: Job<ZkTLSJobData, void>,
): Promise<void> {
  const { taskId, input } = job.data;

  const task = await Task.findById(taskId);
  if (!task) {
    logger.warn({ taskId, jobId: job.id }, '[zkTLS worker] task not found');
    return;
  }
  if (task.status === 'COMPLETED' || task.status === 'RUNNING') return;

  const parsedInput = parseZkTLSJobInput(input);
  await Task.updateTaskStatus({ taskId, status: 'RUNNING' });

  let result;
  try {
    result = await runZkTLSProcessor(taskId, parsedInput);
  } catch (error) {
    const decision = decideZkTLSError(error, { currentDeferCount: task.deferCount ?? 0 });
    await recordOutcome(
      task,
      decision.action === 'defer'
        ? {
            kind: 'defer',
            reason: decision.reason,
            deferUntil: decision.deferUntil,
            error: decision.sourceError ?? error,
          }
        : { kind: 'fail', error },
    );
    return;
  }

  if (result.action === 'defer') {
    await recordOutcome(task, {
      kind: 'defer',
      reason: result.reason,
      deferUntil: result.deferUntil,
      error: result.sourceError ?? result,
    });
    return;
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await Task.updateTaskStatus({ taskId, status: 'COMPLETED' }, { session });
      await Task.createTask(
        {
          type: 'noir',
          pipelineId: task.pipelineId,
          input: {
            zkTLSTaskId: taskId,
            symbol: parsedInput.symbol,
            startTime: parsedInput.startTime,
            endTime: parsedInput.endTime,
            circuitInput: result.input,
          },
        },
        { session },
      );
    });
  } finally {
    await session.endSession();
  }
}
