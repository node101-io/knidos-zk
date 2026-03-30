import type { Job } from "bullmq";
import mongoose from "mongoose";
import path from "path";
import Task from "../db/models/Task.js";
import { runZkTLSProcessor } from "../processors/zkTLS.js";
import type { ZkTLSProcessorInput } from "../types.js";

export type ZkTLSJobData = {
  taskId: string;
  input: ZkTLSProcessorInput;
};

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
    await Task.updateOne(
      { _id: taskId },
      { status: "RUNNING" }
    );

    const result = await runZkTLSProcessor(input);

    const session = await mongoose.startSession();

    try {
      await session.withTransaction(async () => {
        await Task.updateOne(
          { _id: taskId },
          { status: "COMPLETED" },
          { session }
        );

        const baseDir = path.resolve(process.cwd(), "circuit-runs");
        const taskNoirDir = path.join(baseDir, task.pipelineId.toString());

        await Task.create(
          [
            {
              type: "noir",
              pipelineId: task.pipelineId,
              input: {
                zkTLSTaskId: taskId,
                circuitInput: result,
                noirCircuitDir: taskNoirDir,
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
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);

    await Task.updateOne(
      { _id: taskId },
      { status: "FAILED", error: errorMessage }
    );

    throw error;
  }
}