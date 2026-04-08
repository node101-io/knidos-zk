import { Queue } from 'bullmq';
import { connection } from '../config/redis.js';
import { QUEUE_NAMES } from '../config/queueNames.js';

export const noirQueue = new Queue(QUEUE_NAMES.NOIR, {
  connection: connection,
});
