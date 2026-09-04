import { Queue, type Job } from 'bullmq';
import mongoose from 'mongoose';

import { Task } from '../../db/task.js';

import { createTask, updateTaskStatus } from '../../db/task-helpers.js';
import { redis } from '../../shared/redis.js';
import type { TaskEventCtx } from '../../shared/task-event.js';
import { classifyError, decideZkTLSError } from '../../primus/errors.js';
import { serializeError } from '../../utils/error.js';
import type { ZkTLSJobData } from '../types.js';
import { parseZkTLSJobInput } from '../validation.js';
import { runZkTLSProcessor } from './processor.js';

export const zkTLSQueue = new Queue('zkTLS-queue', { connection: redis });

type TaskRecord = { _id: { toString(): string }; deferCount?: number | null };

type Outcome =
  | { kind: 'defer'; reason: string; deferUntil: Date; error: unknown }
  | { kind: 'fail'; error: unknown };

async function recordOutcome(task: TaskRecord, outcome: Outcome, ctx: TaskEventCtx): Promise<void> {
  const taskId = task._id.toString();
  if (outcome.kind === 'defer') {
    const deferCount = (task.deferCount ?? 0) + 1;
    await updateTaskStatus({
      taskId,
      status: 'DEFERRED',
      error: serializeError(outcome.error),
      deferReason: outcome.reason,
      deferUntil: outcome.deferUntil,
      deferCount,
    });
    ctx.set({
      outcome: 'deferred',
      deferReason: outcome.reason,
      deferUntil: outcome.deferUntil.toISOString(),
      deferCount,
      errorClass: classifyError(outcome.error),
      error: serializeError(outcome.error),
    });
    return;
  }
  await updateTaskStatus({
    taskId,
    status: 'FAILED',
    error: serializeError(outcome.error),
  });
  ctx.set({
    outcome: 'failed',
    errorClass: classifyError(outcome.error),
    error: serializeError(outcome.error),
  });
}

export async function processZkTLSJob(
  _workerId: number,
  job: Job<ZkTLSJobData, void>,
  ctx: TaskEventCtx,
): Promise<void> {
  const { taskId, input } = job.data;
  ctx.set({ type: 'zkTLS' });

  const task = await Task.findById(taskId);
  if (!task) {
    ctx.set({ outcome: 'skipped', skipReason: 'task_not_found' });
    return;
  }
  if (task.status === 'COMPLETED' || task.status === 'RUNNING') {
    ctx.set({ outcome: 'skipped', skipReason: 'already_completed_or_running' });
    return;
  }

  const parsedInput = parseZkTLSJobInput(input);
  ctx.set({
    windowStart: parsedInput.startTime,
    windowEnd: parsedInput.endTime,
  });

  await updateTaskStatus({ taskId, status: 'RUNNING' });

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
      ctx,
    );
    return;
  }

  if (result.action === 'defer') {
    await recordOutcome(
      task,
      {
        kind: 'defer',
        reason: result.reason,
        deferUntil: result.deferUntil,
        error: result.sourceError ?? result,
      },
      ctx,
    );
    return;
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await updateTaskStatus({ taskId, status: 'COMPLETED' }, { session });
      await Task.updateOne({ _id: taskId }, { $unset: { primus: '' } }, { session });
      await createTask(
        {
          type: 'noir',
          input: {
            zkTLSTaskId: taskId,
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
