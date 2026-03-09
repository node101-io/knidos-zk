import { Worker, Job } from "bullmq";
import { connection } from "../config/redis";
import { QUEUE_NAMES } from "../config/queueNames";
import type { PipelineJobData } from "../types";

export const zkverifyWorker = new Worker<PipelineJobData>(
  QUEUE_NAMES.ZKVERIFY,
  async (job: Job<PipelineJobData>) => {
    console.log("[zkVerify worker] started:", job.data);

    await new Promise((resolve) => setTimeout(resolve, 1000));

    console.log("[zkVerify worker] verification finished");
    console.log("[Pipeline] COMPLETED for pipelineRunId:", job.data.pipelineRunId);
  },
  { connection }
);

zkverifyWorker.on("completed", (job) => {
  console.log(`[zkVerify worker] completed job ${job.id}`);
});

zkverifyWorker.on("failed", (job, err) => {
  console.error(`[zkVerify worker] failed job ${job?.id}`, err);
});