import { Queue } from "bullmq";
import { connection } from "../config/redis";
import { QUEUE_NAMES } from "../config/queueNames";
import type { PipelineJobData, ZkTlsJobName } from "../types";

export const zktlsQueue = new Queue<PipelineJobData, void, ZkTlsJobName>(
  QUEUE_NAMES.ZKTLS,
  { connection }
);