import { Worker, Job } from "bullmq";
import { connection } from "../config/redis";
import { JOB_NAMES, QUEUE_NAMES } from "../config/queueNames";
import { noirQueue } from "../queues/noir";
import type { PipelineJobData } from "../types";

export const zktlsWorker = new Worker<PipelineJobData>(
  QUEUE_NAMES.ZKTLS,
  async (job: Job<PipelineJobData>) => {
    console.log("[zkTLS worker] started:", job.data);

    await new Promise((resolve) => setTimeout(resolve, 1000));

    console.log("[zkTLS worker] finished zkTLS generation");

    await noirQueue.add(JOB_NAMES.NOIR_PROCESS, job.data);

    console.log("[zkTLS worker] pushed job to Noir queue");
  },
  { connection }
);

zktlsWorker.on("completed", (job) => {
  console.log(`[zkTLS worker] completed job ${job.id}`);
});

zktlsWorker.on("failed", (job, err) => {
  console.error(`[zkTLS worker] failed job ${job?.id}`, err);
});