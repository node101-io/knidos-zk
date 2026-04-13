import Task from '../db/task.js';
import logger from '../shared/logger.js';

export async function runCleanupOnce(): Promise<void> {
  const recoverableTasks = await Task.find({
    status: { $in: ['QUEUED', 'RUNNING'] },
    type: { $in: ['zkTLS', 'noir', 'zkVerify'] },
  });

  if (recoverableTasks.length === 0) return;

  for (const task of recoverableTasks) {
    const taskId = task._id.toString();

    await Task.updateTaskStatus({
      taskId,
      status: 'PENDING',
      error: {
        message: `[cleanup] task was ${task.status} during startup and moved back to PENDING`,
      },
    });

    logger.warn(
      {
        taskId,
        type: task.type,
        previousStatus: task.status,
      },
      '[cleanup] task moved back to PENDING during startup recovery',
    );
  }
}
