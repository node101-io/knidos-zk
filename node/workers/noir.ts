import { Worker, Job } from "bullmq";
import { connection } from "../config/redis";
import { JOB_NAMES, QUEUE_NAMES } from "../config/queueNames";
import { zkverifyQueue } from "../queues/zkVerify";
import type { PipelineJobData } from "../types";

export const noirWorker = new Worker<PipelineJobData>(
  QUEUE_NAMES.NOIR,
  async (job: Job<PipelineJobData>) => {
    console.log("[Noir worker] started:", job.data);

    await new Promise((resolve) => setTimeout(resolve, 1000));

    console.log("[Noir worker] finished proof generation");

    await zkverifyQueue.add(JOB_NAMES.ZKVERIFY_PROCESS, job.data);

    console.log("[Noir worker] pushed job to zkVerify queue");
  },
  { connection }
);

noirWorker.on("completed", (job) => {
  console.log(`[Noir worker] completed job ${job.id}`);
});

noirWorker.on("failed", (job, err) => {
  console.error(`[Noir worker] failed job ${job?.id}`, err);
});