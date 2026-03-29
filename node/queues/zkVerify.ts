import { Queue } from "bullmq";
import { connection } from "../config/redis";
import { QUEUE_NAMES } from "../config/queueNames";

export const zkVerifyQueue = new Queue(QUEUE_NAMES.ZKVERIFY,
  { connection },
);