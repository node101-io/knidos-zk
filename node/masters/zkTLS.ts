import cron from "node-cron";
import Task from "../db/models/Task";
import { zkTLSQueue } from "../queues/zkTLS";
import { markTaskQueued } from "../services/taskLifeCycle";

export function startZkTLSMaster() {
  cron.schedule("* * * * *", async () => {
    try {
      const pendingTasks = await Task.find({
        type: "zkTLS",
        status: "PENDING",
      }).limit(20);

      if (pendingTasks.length === 0) {
        return;
      }

      for (const task of pendingTasks) {
        await zkTLSQueue.add(
          "zkTLS-job",
          {
            taskId: task._id.toString(),
            input: task.input,
          },
          {
            jobId: task._id.toString(),
            removeOnComplete: 100,
            removeOnFail: 100,
          }
        );

        await markTaskQueued(task._id.toString());
        console.log(`[zkTLS master] queued task ${task._id}`);
      }
    } catch (error) {
      console.error("[zkTLS master] error:", error);
    }
  });
}