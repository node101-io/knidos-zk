import Task from '../db/task.js';
import logger from '../shared/logger.js';

const ZKTLS_TIMEOUT_MS = 1 * 60 * 1000; // 5 min fot zkTLS
const ZKVERIFY_TIMEOUT_MS = 1 * 60 * 1000; // 5 min for zkVerify
const NOIR_TIMEOUT_MS = 20 * 60 * 1000; // 20 min for Noir proofs

type TaskType = 'zkTLS' | 'noir' | 'zkVerify';

function getTimeoutMs(type: TaskType): number {
  if (type === 'noir') return NOIR_TIMEOUT_MS;
  if (type === 'zkVerify') return ZKVERIFY_TIMEOUT_MS;
  return ZKTLS_TIMEOUT_MS;
}

function isTaskStuck(task: { type: TaskType; attemptStartedAt?: Date | null }): boolean {
  if (!task.attemptStartedAt) return false;

  const timeoutMs = getTimeoutMs(task.type);
  const deadline = Date.now() - timeoutMs;

  return task.attemptStartedAt.getTime() < deadline;
}

export async function runCleanupOnce(): Promise<void> {
  const runningTasks = await Task.find({
    status: 'RUNNING',
    type: { $in: ['zkTLS', 'noir', 'zkVerify'] },
    attemptStartedAt: { $ne: null },
  });

  if (runningTasks.length === 0) return;

  for (const task of runningTasks) {
    const taskId = task._id.toString();

    if (!isTaskStuck(task)) {
      continue;
    }

    const timeoutMinutes = getTimeoutMs(task.type as TaskType) / (60 * 1000); // for logging

    if (task.attemptCount >= task.maxAttempt) {
      // task which stucked at RUNNING & attemptCount >= maxAttempt -> marked FAILED
      await Task.updateTaskStatus({
        taskId,
        status: 'FAILED',
        error: {
          message: `[cleanup] task exceeded max attempts after being stuck in RUNNING for more than ${timeoutMinutes} minutes`,
        },
      });

      logger.warn(
        {
          taskId,
          type: task.type,
          attemptCount: task.attemptCount,
          maxAttempt: task.maxAttempt,
        },
        '[cleanup] stuck task marked as FAILED',
      );

      continue;
    }

    await Task.updateTaskStatus({
      // if isTaskStuck true mark as PENDING
      taskId,
      status: 'PENDING',
      error: {
        message: `[cleanup] task was stuck in RUNNING for more than ${timeoutMinutes} minutes and moved back to PENDING`,
      },
    });

    logger.warn(
      {
        taskId,
        type: task.type,
        attemptCount: task.attemptCount,
        maxAttempt: task.maxAttempt,
      },
      '[cleanup] stuck task moved back to PENDING',
    );
  }
}
