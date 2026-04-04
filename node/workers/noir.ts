import type { Job } from "bullmq";
import mongoose from "mongoose";

import Task from "../db/models/Task.js";
import logger from "../logger.js";
import type { NoirJobData } from "../types.js";
import { runNoirProcessor } from "../processors/noir";

export async function processNoirJob(
  workerId: number,
  job: Job<NoirJobData, void, string>,
): Promise<void> {
  const { taskId, input} = job.data;

  const task = await Task.findById(taskId);
  if (!task) {
    logger.warn({ taskId, jobId: job.id }, "[noir worker] task not found");
    return;
  }

  try {
    await Task.updateTaskStatus2({
      taskId,
      status: "RUNNING"
    });

    logger.info(
      { taskId, workerId, noirProjectDir: input.noirCircuitDir },
      "[noir worker] starting noir task",
    );

    const result = await runNoirProcessor(input);

    const session = await mongoose.startSession();

    try {
      await session.withTransaction(async () => {
        await Task.updateTaskStatus2(
          {
            taskId,
            status: "COMPLETED",
            result,
          },
          { session }
        );

        await Task.create(
          [
            {
              type: "zkVerify",
              pipelineId: task.pipelineId,
              input: {
                noirTaskId: taskId,
                targetDir: result.targetDir,
              },
              maxAttempt: task.maxAttempt,
              status: "PENDING",
            },
          ],
          { session }
        );
      });
    } finally {
      await session.endSession();
    }

    logger.info(
      { taskId, workerId },
      "[noir worker] completed noir task",
    );

    logger.info(
      { taskId, workerId },
      "[noir worker] created zkVerify task",
    );
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);

    await Task.updateTaskStatus2({
      taskId,
      status: "FAILED",
      error: errorMessage,
    });

    logger.error(
      { taskId, workerId, error: errorMessage },
      "[noir worker] failed noir task",
    );

    throw error;
  }
}