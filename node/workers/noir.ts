import type { Job } from "bullmq";
import { Types } from "mongoose";

import Task from "../db/models/Task.js";
import logger from "../logger.js";
import type { NoirJobData } from "../types.js";
import {  runNoirProcessor  } from "../processors/noir"

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
function createTaskAsync(body: {
  type: "zkTLS" | "noir" | "zkVerify";
  pipelineId: Types.ObjectId;
  input: Record<string, unknown>;
  maxAttempt?: number;
}) {
  return new Promise((resolve, reject) => {
    Task.createTask(body, (err, task) => {
      if (err) return reject(err);
      resolve(task);
    });
  });
}


export async function processNoirJob(
  workerId: number,
  job: Job<NoirJobData, void, string>,
): Promise<void> {
  const { taskId, input } = job.data;

  const task = await Task.findById(taskId);
  if (!task) {
    logger.warn({ taskId, jobId: job.id }, "[noir worker] task not found");
    return;
  }

  try {
    await updateTaskStatusAsync({
      taskId,
      status: "RUNNING",
    });

    logger.info(
      { taskId, workerId, noirProjectDir: input.noirCircuitDir },
      "[noir worker] starting noir task",
    );

    const result = await runNoirProcessor(input);

    await updateTaskStatusAsync({
      taskId,
      status: "COMPLETED",
      result,
    });

    logger.info(
      { taskId, workerId },
      "[noir worker] completed noir task",
    );

    await createTaskAsync({
      type: "zkVerify",
      pipelineId: task.pipelineId,
      input: {
        noirTaskId: taskId,
        targetDir: result.targetDir,
      },
      maxAttempt: task.maxAttempt,
    });

    logger.info(
      { taskId, workerId },
      "[noir worker] created zkVerify task",
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
      "[noir worker] failed noir task",
    );

    throw error;
  }
}