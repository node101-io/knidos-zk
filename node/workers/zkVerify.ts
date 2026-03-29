import type { Job } from "bullmq";
import Task from "../db/models/Task.js";
import logger from "../logger.js";
import type { ZkVerifyJobData } from "../types.js";
import { runZkVerifyProcessor } from "../processors/zkVerify.js";

function updateTaskStatusAsync(body: {
  taskId: string;
  status: "PENDING" | "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
  result?: unknown;
  error?: unknown;
}) {
  return new Promise((resolve, reject) => {
    Task.updateTaskStatus(body, (err, task) => {
      if (err) return reject(err);
      resolve(task);
    });
  });
}

export async function processZkVerifyJob(
  workerId: number,
  job: Job<ZkVerifyJobData, void, string>,
): Promise<void> {
  const { taskId, input } = job.data;

  const task = await Task.findById(taskId);
  if (!task) {
    logger.warn(
      { taskId, jobId: job.id },
      "[zkVerify worker] task not found",
    );
    return;
  }

  try {
    await updateTaskStatusAsync({
      taskId,
      status: "RUNNING",
    });

    logger.info(
      { taskId, workerId, targetDir: input.targetDir },
      "[zkVerify worker] starting zkVerify task",
    );

    const result = await runZkVerifyProcessor(input);

    await updateTaskStatusAsync({
      taskId,
      status: "COMPLETED",
      result,
    });

    logger.info(
      { taskId, workerId, aggregationId: result.aggregationId },
      "[zkVerify worker] completed zkVerify task",
    );
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);

    await updateTaskStatusAsync({
      taskId,
      status: "FAILED",
      error: errorMessage,
    });

    logger.error(
      { taskId, workerId, error: errorMessage },
      "[zkVerify worker] failed zkVerify task",
    );

    throw error;
  }
}