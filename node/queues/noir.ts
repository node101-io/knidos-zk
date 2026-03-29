import { Queue } from "bullmq";
import { connection } from "../config/redis";
import { QUEUE_NAMES } from "../config/queueNames";

export const noirQueue = new Queue(QUEUE_NAMES.NOIR, {
  connection: connection,
});