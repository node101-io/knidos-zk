import cron from 'node-cron';
import mongoose from 'mongoose';

import Task from '../db/task.js';
import { runCleanupOnce } from './cleanup.js';
import logger from '../shared/logger.js';

const CLEANUP_CRON = '* * * * *';
const ZKTLS_SCHEDULE_CRON = '0,15,30,45 * * * *';
const ZKTLS_WINDOW_MS = 15 * 60 * 1000;

export function startScheduler(): void {
  cron.schedule(CLEANUP_CRON, async () => {
    try {
      await runCleanupOnce();
    } catch (error) {
      logger.error({ error }, '[scheduler] periodic cleanup failed');
    }
  });

  // TODO: catch-up - on startup, look at the most recent processed slot in the
  // DB and enqueue a task for every missing 15-minute slot up to the current one,
  // so downtime doesn't leave gaps in the zkTLS history.
  cron.schedule(ZKTLS_SCHEDULE_CRON, async () => {
    logger.info('[scheduler] creating zkTLS task');

    const now = Date.now();
    const endTime = now - (now % ZKTLS_WINDOW_MS);
    const startTime = endTime - ZKTLS_WINDOW_MS;

    try {
      const task = await Task.createTask({
        type: 'zkTLS',
        pipelineId: new mongoose.Types.ObjectId(),
        input: {
          startTime,
          endTime,
          baseBalance: 100000000, // TODO: fetch these time info dynamically
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
