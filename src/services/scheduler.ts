import cron from 'node-cron';
import mongoose from 'mongoose';

import Task from '../db/task.js';
import { runCleanupOnce } from './cleanup.js';
import logger from '../shared/logger.js';

const CLEANUP_CRON = '* * * * *';
const ZKTLS_SCHEDULE_CRON = '*/3 * * * *';
const START_TIME = 1769172979000; // For testing
const END_TIME = 1769172996000; // For testing

export function startScheduler(): void {
  cron.schedule(CLEANUP_CRON, async () => {
    try {
      await runCleanupOnce();
    } catch (error) {
      logger.error({ error }, '[scheduler] periodic cleanup failed');
    }
  });

  cron.schedule(ZKTLS_SCHEDULE_CRON, async () => {
    logger.info('[scheduler] creating zkTLS task');

    // const now = new Date();
    // const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60 * 1000);

    try {
      const task = await Task.createTask({
        type: 'zkTLS',
        pipelineId: new mongoose.Types.ObjectId(),
        input: {
          startTime: START_TIME, //fifteenMinutesAgo.toISOString()
          endTime: END_TIME, //now.toISOString()
          baseBalance: 100000000, //TODO: fetch these time info dynamically
          threshold: 50000000,
        },
      });
      logger.info({ taskId: task._id.toString() }, '[scheduler] zkTLS task created');
    } catch (error) {
      logger.error({ error }, '[scheduler] failed to create task');
    }
  });

  logger.info(
    { cleanupCron: CLEANUP_CRON, zkTLSCron: ZKTLS_SCHEDULE_CRON },
    '[scheduler] cron jobs registered',
  );
}
