import { Queue } from 'bullmq';
import { connection } from '../config/redis.js';
import { QUEUE_NAMES } from '../config/queueNames.js';

export const zkTLSQueue = new Queue(QUEUE_NAMES.ZKTLS, {
  connection: connection,
});
