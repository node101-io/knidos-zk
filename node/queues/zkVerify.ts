import { Queue } from "bullmq";
import { connection } from "../config/redis.js";
import { QUEUE_NAMES } from "../config/queueNames.js";

export const zkVerifyQueue = new Queue(QUEUE_NAMES.ZKVERIFY,
  { connection },
);