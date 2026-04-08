import Task from '../db/task.js';

export async function markTaskQueued(taskId: string) {
  return Task.findByIdAndUpdate(taskId, {
    status: 'QUEUED',
    queuedAt: new Date(),
  });
}
