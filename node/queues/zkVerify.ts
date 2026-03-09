import { Queue } from "bullmq";
import { connection } from "../config/redis";
import { QUEUE_NAMES } from "../config/queueNames";
import type { PipelineJobData, ZkVerifyJobName } from "../types";

export const zkverifyQueue = new Queue<PipelineJobData, void, ZkVerifyJobName>(
  QUEUE_NAMES.ZKVERIFY,
  { connection }
);