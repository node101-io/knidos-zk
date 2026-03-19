import  Task from "../db/models/Task";

export async function markTaskQueued(taskId: string) {
  return Task.findByIdAndUpdate(taskId, {
    status: "QUEUED",
    queuedAt: new Date(),
  });
}