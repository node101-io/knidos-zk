import type { Job } from "bullmq";
import Task from "../db/models/Task.js";
import { runZkTLSProcessor } from "../processors/zkTLS.js";
import type { ZkTLSProcessorInput } from "../types.js";


export type ZkTLSJobData = {
  taskId: string;
  input: ZkTLSProcessorInput;
};

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
  pipelineId: any;
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

export async function processZkTLSJob(
  workerId: number,
  job: Job<ZkTLSJobData, void, string>,
): Promise<void> {
  const { taskId, input } = job.data;

  const task = await Task.findById(taskId);
  if (!task) {
    console.warn(`[zkTLS worker ${workerId}] task ${taskId} not found`);
    return;
  }

  try {
    await updateTaskStatusAsync({
      taskId,
      status: "RUNNING",
    });

    const result = await runZkTLSProcessor(input);

    await updateTaskStatusAsync({
      taskId,
      status: "COMPLETED",
    });

    await createTaskAsync({
      type: "noir",
      pipelineId: task.pipelineId,
      input: {
        zkTLSTaskId: taskId,
        circuitInput: result,
        circuitTomlRoute: `../../circuit/tmp/${taskId}`,
      },
      maxAttempt: task.maxAttempt,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);

    await updateTaskStatusAsync({
      taskId,
      status: "FAILED",
      error: errorMessage,
    });

    throw error;
  }
}