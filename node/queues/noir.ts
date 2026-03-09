import { Queue } from "bullmq";
import { connection } from "../config/redis";
import { QUEUE_NAMES } from "../config/queueNames";
import type { PipelineJobData, NoirJobName} from "../types";

export const noirQueue = new Queue<PipelineJobData, void, NoirJobName>(
  QUEUE_NAMES.NOIR,
  { connection }
);