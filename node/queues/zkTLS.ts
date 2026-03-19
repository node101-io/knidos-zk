import { Queue } from "bullmq";
import { connection } from "../config/redis";
import { QUEUE_NAMES } from "../config/queueNames";

export const zkTLSQueue = new Queue(QUEUE_NAMES.ZKTLS, {
  connection: connection,
});