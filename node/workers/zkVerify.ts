import type { Job } from "bullmq";
import mongoose from "mongoose";
import fs from "fs/promises";
import path from "path";

import Task from "../db/models/Task.js";
import logger from "../logger.js";
import type { ZkVerifyJobData } from "../types.js";
import { runZkVerifyProcessor } from "../processors/zkVerify.js";
import VerificationRecord from "../db/models/VerificationRecord.js";

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
    await Task.updateTaskStatus({
      taskId,
      status: "RUNNING",
    });

    logger.info(
      { taskId, workerId, targetDir: input.targetDir },
      "[zkVerify worker] starting zkVerify task",
    );

    const result = await runZkVerifyProcessor(input);

    const session = await mongoose.startSession();

    try {
      await session.withTransaction(async () => {
        await Task.updateTaskStatus(
          {
            taskId,
            status: "COMPLETED",
            result,
          },
          { session }
        );

        await VerificationRecord.create(
          [
            {
              pipelineId: task.pipelineId,
              zkVerifyTaskId: task._id,
              noirTaskId: input.noirTaskId,

              statement: result.statement,
              aggregationId: result.aggregationId,
              includedInBlock: result.includedInBlock,

              variant: result.variant,

              vk: result.vk,
              proof: result.proof,
              publicSignals: result.publicSignals,
            },
          ],
          { session }
        );
      });
    } finally {
      await session.endSession();
    }

    const pipelineDir = path.dirname(path.resolve(input.targetDir));

    try {
      await fs.rm(pipelineDir, {
        recursive: true,
        force: true,
      });

      logger.info(
        { taskId, workerId, pipelineDir },
        "[zkVerify worker] deleted pipeline directory",
      );
    } catch (cleanupError) {
      logger.warn(
        { taskId, workerId, pipelineDir, cleanupError },
        "[zkVerify worker] zkVerify succeeded but pipeline cleanup failed",
      );
    }

    logger.info(
      { taskId, workerId, aggregationId: result.aggregationId },
      "[zkVerify worker] completed zkVerify task",
    );
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);

    const isRetryableTxPoolError = //TODO: ask necip
      errorMessage.includes("Priority is too low") ||
      errorMessage.includes("transaction already in the pool") ||
      errorMessage.includes("nonce") ||
      errorMessage.includes("replace another transaction already in the pool");

    const freshTask = await Task.findById(taskId);

    if (!freshTask) {
      logger.error({ taskId, workerId }, "[zkVerify worker] task disappeared during error handling");
      throw error;
    }

    if (isRetryableTxPoolError && freshTask.attemptCount < freshTask.maxAttempt) {
      await Task.updateTaskStatus({
        taskId,
        status: "PENDING",
        error: errorMessage,
      });

      logger.warn(
        { taskId, workerId, error: errorMessage, attemptCount: freshTask.attemptCount, maxAttempt: freshTask.maxAttempt },
        "[zkVerify worker] retryable tx pool error, task returned to PENDING",
      );
      return;
    }

    await Task.updateTaskStatus({
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