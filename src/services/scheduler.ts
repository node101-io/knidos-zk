import cron from 'node-cron';
import mongoose from 'mongoose';

import Task from '../db/task.js';
import { runCleanupOnce } from './cleanup.js';
import logger from '../shared/logger.js';

const CLEANUP_CRON = '* * * * *';
const ZKTLS_SCHEDULE_CRON = '0,15,30,45 * * * *';
const ZKTLS_WINDOW_MS = 15 * 60 * 1000;

async function catchUpMissedSlots(): Promise<void> {
  const latest = await Task.findOne({ type: 'zkTLS' }).sort({ _id: -1 }).lean();
  const now = Date.now();
  const currentSlotEnd = now - (now % ZKTLS_WINDOW_MS);

  if (!latest) {
    const startTime = currentSlotEnd - ZKTLS_WINDOW_MS;
    await Task.createTask({
      type: 'zkTLS',
      pipelineId: new mongoose.Types.ObjectId(),
      input: { startTime, endTime: currentSlotEnd, baseBalance: 100000000, threshold: 50000000 },
    });
    logger.info({ created: 1 }, '[scheduler] catch-up: no previous task, created current slot');
    return;
  }

  const lastEndTime = (latest.input as { endTime: number }).endTime;

  if (lastEndTime >= currentSlotEnd) {
    logger.info(
      { lastEndTime: new Date(lastEndTime).toISOString(), taskId: latest._id.toString() },
      '[scheduler] catch-up: already up to date',
    );
    return;
  }

  let created = 0;
  for (
    let endTime = lastEndTime + ZKTLS_WINDOW_MS;
    endTime <= currentSlotEnd;
    endTime += ZKTLS_WINDOW_MS
  ) {
    const startTime = endTime - ZKTLS_WINDOW_MS;

    const exists = await Task.findOne({ type: 'zkTLS', 'input.endTime': endTime }).lean();
    if (exists) continue;

    await Task.createTask({
      type: 'zkTLS',
      pipelineId: new mongoose.Types.ObjectId(),
      input: { startTime, endTime, baseBalance: 100000000, threshold: 50000000 },
    });
    created++;
  }

  logger.info({ created, from: lastEndTime, to: currentSlotEnd }, '[scheduler] catch-up completed');
}

export async function startScheduler(): Promise<void> {
  await catchUpMissedSlots();

  cron.schedule(CLEANUP_CRON, async () => {
    try {
      await runCleanupOnce();
    } catch (error) {
      logger.error({ error }, '[scheduler] periodic cleanup failed');
    }
  });

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
