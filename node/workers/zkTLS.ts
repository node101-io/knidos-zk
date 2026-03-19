import { Worker, Job } from "bullmq";
import { connection } from "../config/redis";
import { QUEUE_NAMES } from "../config/queueNames";
import Task from "../db/models/Task";
import { runZkTLSProcessor } from "../processors/zkTLS";

type ZkTLSProcessorInput = {
  walletAddress: string;
  startTime: number;
  endTime: number;
  proofType?: string;
  baseBalance?: number;
  threshold?: number;
  fillCount?: number;
};

type ZkTLSJobData = {
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

export function startZkTLSWorker() {
  const worker = new Worker(
    QUEUE_NAMES.ZKTLS,
    async (job: Job<ZkTLSJobData>) => {
      const { taskId, input } = job.data;

      const task = await Task.findById(taskId);
      if (!task) {
        throw new Error("document_not_found");
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
          result,
        });

        await createTaskAsync({
          type: "noir",
          pipelineId: task.pipelineId,
          input: {
            zkTLSTaskId: taskId,
            zkTLSResult: result,
          },
          maxAttempt: task.maxAttempt,
        });

        console.log(`[zkTLS worker] completed task ${taskId}`);
        return result;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        await updateTaskStatusAsync({
          taskId,
          status: "FAILED",
          error: errorMessage,
        });

        console.error(`[zkTLS worker] failed task ${taskId}:`, errorMessage);
        throw error;
      }
    },
    {
      connection: connection,
    }
  );

  worker.on("completed", (job) => {
    console.log(`[zkTLS worker] BullMQ job completed: ${job.id}`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[zkTLS worker] BullMQ job failed: ${job?.id}`, err.message);
  });

  return worker;
}