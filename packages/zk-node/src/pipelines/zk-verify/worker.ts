import { Queue, type Job } from 'bullmq';
import mongoose from 'mongoose';

import { Task } from '../../db/task.js';
import { VerificationRecord } from '../../db/verification-record.js';
import { computeVkHash } from '../../shared/vk-hash.js';
import { type NoirProcessorResult } from '../../types/noir-processor-result.js';

import { updateTaskStatus } from '../../db/task-helpers.js';
import { redis } from '../../shared/redis.js';
import type { TaskEventCtx } from '../../shared/task-event.js';
import type { ZkVerifyJobData } from '../types.js';
import { parseZkVerifyJobInput } from '../validation.js';
import { runZkVerifyProcessor } from './processor.js';

export const zkVerifyQueue = new Queue('zkVerify-queue', { connection: redis });

const ZKVERIFY_MIN_GAP_MS = 15 * 1000;
const ZKVERIFY_SLEEP_STEP_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function processZkVerifyJob(
  _workerId: number,
  job: Job<ZkVerifyJobData, void>,
  ctx: TaskEventCtx,
): Promise<void> {
  const { taskId, input } = job.data;
  ctx.set({ type: 'zkVerify' });

  const task = await Task.findById(taskId);
  if (!task) {
    ctx.set({ outcome: 'skipped', skipReason: 'task_not_found' });
    return;
  }

  if (task.status === 'COMPLETED' || task.status === 'RUNNING') {
    ctx.set({ outcome: 'skipped', skipReason: 'already_completed_or_running' });
    return;
  }

  const parsedInput = parseZkVerifyJobInput(input);
  ctx.set({
    symbol: parsedInput.symbol,
    noirTaskId: parsedInput.noirTaskId,
    windowStart: parsedInput.startTime,
    windowEnd: parsedInput.endTime,
  });

  await updateTaskStatus({ taskId, status: 'RUNNING' });

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
    const sleepMs = Math.min(ZKVERIFY_SLEEP_STEP_MS, remainingMs);
    ctx.bump('zkVerifyWaitMs', sleepMs);
    await sleep(sleepMs);
  }

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

  const stopSubmit = ctx.timer('submit');
  const result = await runZkVerifyProcessor({
    vk: noirResult.vkHex,
    proof: noirResult.proofHex,
    publicSignals: noirResult.publicInputs,
  });
  stopSubmit();

  ctx.set({
    variant: String(result.variant),
    aggregationId: result.aggregationId,
    statement: result.statement,
  });

  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      await updateTaskStatus({ taskId, status: 'COMPLETED' }, { session });

      await VerificationRecord.create(
        [
          {
            zkVerifyTaskId: task._id,
            noirTaskId: new mongoose.Types.ObjectId(parsedInput.noirTaskId),
            symbol: parsedInput.symbol,
            startTime: parsedInput.startTime,
            endTime: parsedInput.endTime,

            variant: result.variant,

            vkHash: computeVkHash(result.vk),
            publicSignals: result.publicSignals,

            ...(result.includedInBlock?.txHash ? { txHash: result.includedInBlock.txHash } : {}),
          },
        ],
        { session },
      );

      await Task.updateOne(
        { _id: new mongoose.Types.ObjectId(parsedInput.noirTaskId) },
        { $unset: { result: '' } },
        { session },
      );
    });
  } finally {
    await session.endSession();
  }
}
